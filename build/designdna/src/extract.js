import { chromium } from "playwright";

const SCHEMA_VERSION = "1.0.0";
const VIEWPORT = Object.freeze({ width: 1440, height: 900 });
const MAX_EXAMPLE_SELECTORS = 6;
const MAX_STYLESHEETS = 500;
const MAX_STYLESHEET_BYTES = 20 * 1024 * 1024;

function errorMessage(error) {
  const message = error instanceof Error ? error.message : String(error);
  const cleaned = message.replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "");
  return cleaned.length > 4_000 ? `${cleaned.slice(0, 4_000)}…` : cleaned;
}

async function safely(notes, label, fallback, operation) {
  try {
    return await operation();
  } catch (error) {
    notes.push(`${label}: ${errorMessage(error)}`);
    return fallback;
  }
}

function instrumentPage() {
  const selectorHint = (element) => {
    if (!(element instanceof Element)) return null;
    if (element.id) return `#${CSS.escape(element.id)}`;
    const classes = [...element.classList].slice(0, 3).map((name) => `.${CSS.escape(name)}`).join("");
    return `${element.localName}${classes}`;
  };

  window.__designDnaIntersectionElements = [];
  window.__designDnaCanvasContexts = [];

  if (window.IntersectionObserver) {
    const NativeIntersectionObserver = window.IntersectionObserver;
    window.IntersectionObserver = new Proxy(NativeIntersectionObserver, {
      construct(Target, argumentsList, NewTarget) {
        const observer = Reflect.construct(Target, argumentsList, NewTarget);
        const nativeObserve = observer.observe.bind(observer);
        observer.observe = (target) => {
          if (target instanceof Element) {
            window.__designDnaIntersectionElements.push(target);
          }
          return nativeObserve(target);
        };
        return observer;
      },
    });
  }

  if (window.HTMLCanvasElement?.prototype?.getContext) {
    const nativeGetContext = window.HTMLCanvasElement.prototype.getContext;
    window.HTMLCanvasElement.prototype.getContext = function patchedGetContext(type, ...args) {
      const normalizedType = String(type || "").toLowerCase();
      window.__designDnaCanvasContexts.push({
        element: this,
        type: normalizedType,
        hint: selectorHint(this),
      });
      return nativeGetContext.call(this, type, ...args);
    };
  }
}

function isCssNameCharacter(character) {
  return Boolean(character && /[a-zA-Z0-9_-]|[^\u0000-\u007f]/.test(character));
}

function consumeCssComment(css, start, end) {
  const closing = css.indexOf("*/", start + 2);
  return closing === -1 || closing >= end ? end : closing + 2;
}

function consumeCssString(css, start, end) {
  const quote = css[start];
  let index = start + 1;
  while (index < end) {
    if (css[index] === "\\") {
      index += 2;
      continue;
    }
    if (css[index] === quote) return index + 1;
    index += 1;
  }
  return end;
}

function isCssUrlStart(css, index, end) {
  if (index + 4 > end || css.slice(index, index + 4).toLowerCase() !== "url(") return false;
  return !isCssNameCharacter(css[index - 1]) && css[index - 1] !== "\\";
}

function consumeCssUrl(css, start, end) {
  let depth = 0;
  let index = start + 3;
  while (index < end) {
    const character = css[index];
    if (character === "\\") {
      index += 2;
      continue;
    }
    if (character === '"' || character === "'") {
      index = consumeCssString(css, index, end);
      continue;
    }
    if (character === "(") depth += 1;
    else if (character === ")") {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
    index += 1;
  }
  return end;
}

function consumeIgnoredCssToken(css, index, end) {
  const character = css[index];
  if (character === "/" && css[index + 1] === "*") return consumeCssComment(css, index, end);
  if (character === '"' || character === "'") return consumeCssString(css, index, end);
  if (isCssUrlStart(css, index, end)) return consumeCssUrl(css, index, end);
  return null;
}

function findMatchingBrace(css, openingIndex, end = css.length) {
  let depth = 0;

  for (let index = openingIndex; index < end; index += 1) {
    const character = css[index];
    const ignoredUntil = consumeIgnoredCssToken(css, index, end);
    if (ignoredUntil !== null) {
      index = ignoredUntil - 1;
      continue;
    }
    if (character === "\\") {
      index += 1;
      continue;
    }
    if (character === "{") depth += 1;
    if (character === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }

  return -1;
}

function findStatementBoundary(css, start, end) {
  let parentheses = 0;
  let brackets = 0;

  for (let index = start; index < end; index += 1) {
    const character = css[index];
    const ignoredUntil = consumeIgnoredCssToken(css, index, end);
    if (ignoredUntil !== null) {
      index = ignoredUntil - 1;
      continue;
    }
    if (character === "\\") {
      index += 1;
      continue;
    }
    if (character === "(") parentheses += 1;
    else if (character === ")") parentheses = Math.max(0, parentheses - 1);
    else if (character === "[") brackets += 1;
    else if (character === "]") brackets = Math.max(0, brackets - 1);
    else if (parentheses === 0 && brackets === 0 && (character === "{" || character === ";")) {
      return { index, type: character };
    }
  }
  return null;
}

function skipWhitespaceAndComments(css, start, end) {
  let index = start;
  while (index < end) {
    if (/\s/.test(css[index])) {
      index += 1;
      continue;
    }
    if (css[index] === "/" && css[index + 1] === "*") {
      const closing = css.indexOf("*/", index + 2);
      return closing === -1 ? end : skipWhitespaceAndComments(css, closing + 2, end);
    }
    break;
  }
  return index;
}

function importUrlFromStatement(statement) {
  const match = statement.match(
    /@import\s+(?:url\(\s*)?(?:["']([^"']+)["']|([^\s)'";]+))\s*\)?/i,
  );
  return match ? match[1] || match[2] : null;
}

function keyframeNameFromHeader(header) {
  const match = header.match(/^@(-[a-z]+-)?keyframes\b([\s\S]*)$/i);
  if (!match) return null;
  const name = match[2].replace(/\/\*[\s\S]*?\*\//g, " ").trim();
  if (!name) return null;
  return {
    name: name.replace(/^(["'])([\s\S]*)\1$/, "$2"),
    vendorPrefix: match[1] || null,
  };
}

function extractKeyframes(css, source) {
  const keyframes = [];
  const notes = [];
  let index = 0;

  while (index < css.length) {
    const ignoredUntil = consumeIgnoredCssToken(css, index, css.length);
    if (ignoredUntil !== null) {
      index = ignoredUntil;
      continue;
    }
    if (css[index] === "\\") {
      index += 2;
      continue;
    }
    if (css[index] !== "@") {
      index += 1;
      continue;
    }

    const atRuleMatch = css.slice(index).match(/^@(-[a-z]+-)?keyframes\b/i);
    if (!atRuleMatch) {
      index += 1;
      continue;
    }
    const boundary = findStatementBoundary(css, index + atRuleMatch[0].length, css.length);
    if (!boundary || boundary.type !== "{") {
      notes.push(`${source}: malformed @keyframes rule near byte ${index}`);
      index += atRuleMatch[0].length;
      continue;
    }
    const header = css.slice(index, boundary.index).trim();
    const identity = keyframeNameFromHeader(header);
    const closing = findMatchingBrace(css, boundary.index, css.length);
    if (!identity || closing === -1) {
      notes.push(`${source}: unterminated or unnamed @keyframes rule near byte ${index}`);
      index = boundary.index + 1;
      continue;
    }
    keyframes.push({
      name: identity.name,
      vendorPrefix: identity.vendorPrefix,
      cssText: css.slice(index, closing + 1),
      source,
    });
    index = closing + 1;
  }

  return { keyframes, notes };
}

function parseCssText(css, source) {
  const keyframeScan = extractKeyframes(css, source);
  const result = {
    imports: [],
    keyframes: keyframeScan.keyframes,
    mediaQueries: [],
    stateRules: [],
    timelineRules: [],
    notes: [...keyframeScan.notes],
  };

  const scan = (start, end) => {
    let cursor = start;
    while (cursor < end) {
      cursor = skipWhitespaceAndComments(css, cursor, end);
      if (cursor >= end) break;
      if (css[cursor] === "}") {
        cursor += 1;
        continue;
      }

      const boundary = findStatementBoundary(css, cursor, end);
      if (!boundary) break;
      const header = css.slice(cursor, boundary.index).trim();

      if (boundary.type === ";") {
        if (/^@import\b/i.test(header)) {
          const rawUrl = importUrlFromStatement(`${header};`);
          if (rawUrl) result.imports.push({ rawUrl, cssText: css.slice(cursor, boundary.index + 1) });
        }
        cursor = boundary.index + 1;
        continue;
      }

      const closing = findMatchingBrace(css, boundary.index, end);
      if (closing === -1) {
        result.notes.push(`${source}: unterminated CSS block near byte ${cursor}`);
        break;
      }

      const cssText = css.slice(cursor, closing + 1);
      const body = css.slice(boundary.index + 1, closing);
      const keyframesMatch = keyframeNameFromHeader(header);
      const mediaMatch = header.match(/^@media\s+([\s\S]+)$/i);

      if (keyframesMatch) {
        // A separate token-aware pass collects keyframes globally so a malformed
        // surrounding block cannot hide otherwise complete animation definitions.
      } else {
        if (mediaMatch) {
          result.mediaQueries.push({
            condition: mediaMatch[1].trim(),
            cssText,
            source,
          });
        }

        if (header.startsWith("@")) {
          scan(boundary.index + 1, closing);
        } else {
          const lowerHeader = header.toLowerCase();
          const lowerBody = body.toLowerCase();
          if (/:(hover|focus|focus-visible|active)\b/.test(lowerHeader) && /animation(?:-name)?\s*:/.test(lowerBody)) {
            result.stateRules.push({ selector: header, declarations: body, cssText, source });
          }
          if (/animation-timeline\s*:|scroll-timeline\s*:|view-timeline\s*:/.test(lowerBody)) {
            result.timelineRules.push({ selector: header, declarations: body, cssText, source });
          }
        }
      }
      cursor = closing + 1;
    }
  };

  scan(0, css.length);
  return result;
}

function mediaWidths(condition) {
  const widths = [];
  const pattern = /(min|max)-(?:device-)?width\s*:\s*(-?\d*\.?\d+)\s*(px|em|rem|vw)?|width\s*(<=|>=|<|>)\s*(-?\d*\.?\d+)\s*(px|em|rem|vw)?|(-?\d*\.?\d+)\s*(px|em|rem|vw)?\s*(<=|>=|<|>)\s*width/gi;
  let match;
  while ((match = pattern.exec(condition))) {
    let kind;
    let value;
    let unit;
    if (match[1]) {
      kind = match[1];
      value = Number(match[2]);
      unit = match[3] || "px";
    } else if (match[4]) {
      kind = match[4];
      value = Number(match[5]);
      unit = match[6] || "px";
    } else {
      kind = match[9] || "width";
      value = Number(match[7]);
      unit = match[8] || "px";
    }
    const pixels = unit === "px" ? value : unit === "em" || unit === "rem" ? value * 16 : null;
    widths.push({ kind, value, unit, approximatePixels: pixels });
  }
  return widths;
}

function mentionsKeyframe(text, name) {
  if (!name) return false;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-zA-Z0-9_-])${escaped}([^a-zA-Z0-9_-]|$)`).test(text);
}

function triggerForSelector(selector) {
  const triggers = [];
  if (/:hover\b/i.test(selector)) triggers.push("hover");
  if (/:focus(?:-visible)?\b/i.test(selector)) triggers.push("focus");
  if (/:active\b/i.test(selector)) triggers.push("active");
  return triggers;
}

function collectComputedDesign(options) {
  const maxExamples = options.maxExamples || 6;
  const excludedElements = new Set(["head", "script", "style", "link", "template", "title"]);
  const fieldNotes = {
    colors: [],
    typography: [],
    spacing: [],
    animations: [],
  };

  const cssEscape = (value) => {
    if (globalThis.CSS?.escape) return CSS.escape(value);
    return String(value).replace(/[^a-zA-Z0-9_-]/g, (character) => `\\${character}`);
  };

  const localSelector = (element, root) => {
    if (element.id) return `#${cssEscape(element.id)}`;
    const segments = [];
    let current = element;
    while (current && current !== root && current.nodeType === Node.ELEMENT_NODE && segments.length < 6) {
      let segment = current.localName;
      const stableClasses = [...current.classList]
        .filter((name) => name.length < 80 && !/[\d]{5,}/.test(name))
        .slice(0, 2);
      if (stableClasses.length) {
        segment += stableClasses.map((name) => `.${cssEscape(name)}`).join("");
      } else if (current.parentElement) {
        const siblings = [...current.parentElement.children].filter(
          (sibling) => sibling.localName === current.localName,
        );
        if (siblings.length > 1) segment += `:nth-of-type(${siblings.indexOf(current) + 1})`;
      }
      segments.unshift(segment);
      const candidate = segments.join(" > ");
      try {
        if (root.querySelectorAll(candidate).length === 1) return candidate;
      } catch {
        // Fall back to a longer structural selector.
      }
      current = current.parentElement;
    }
    return segments.join(" > ") || element.localName;
  };

  const selectorFor = (element) => {
    if (!(element instanceof Element)) return null;
    const root = element.getRootNode();
    const local = localSelector(element, root);
    if (root instanceof ShadowRoot) return `${selectorFor(root.host)} >>> ${local}`;
    return local;
  };

  const collectElements = (root = document, output = []) => {
    for (const element of root.querySelectorAll("*")) {
      const localName = String(element.localName || "").toLowerCase();
      if (excludedElements.has(localName) || element.closest("head")) continue;
      output.push(element);
      if (element.shadowRoot) collectElements(element.shadowRoot, output);
    }
    return output;
  };

  const splitCssList = (value) => {
    const parts = [];
    let start = 0;
    let depth = 0;
    let quote = null;
    for (let index = 0; index < value.length; index += 1) {
      const character = value[index];
      if (quote) {
        if (character === "\\") index += 1;
        else if (character === quote) quote = null;
      } else if (character === '"' || character === "'") quote = character;
      else if (character === "(") depth += 1;
      else if (character === ")") depth = Math.max(0, depth - 1);
      else if (character === "," && depth === 0) {
        parts.push(value.slice(start, index).trim());
        start = index + 1;
      }
    }
    parts.push(value.slice(start).trim());
    return parts.filter(Boolean);
  };

  const increment = (map, key, selector, details = {}) => {
    if (!key) return;
    let entry = map.get(key);
    if (!entry) {
      entry = { value: key, count: 0, exampleSelectors: [], ...details };
      map.set(key, entry);
    }
    entry.count += 1;
    if (selector && entry.exampleSelectors.length < maxExamples && !entry.exampleSelectors.includes(selector)) {
      entry.exampleSelectors.push(selector);
    }
    return entry;
  };

  const isVisible = (element, style) => {
    if (style.display === "none" || style.visibility === "hidden") return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };

  const sampleText = (element) => {
    let text = [...element.childNodes]
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => node.textContent || "")
      .join(" ");
    if (!text.trim() && element instanceof HTMLInputElement) text = element.value || element.placeholder;
    if (!text.trim() && element instanceof HTMLTextAreaElement) text = element.value || element.placeholder;
    if (!text.trim() && element instanceof HTMLImageElement) text = element.alt;
    return text.replace(/\s+/g, " ").trim().slice(0, 160);
  };

  const colorMap = new Map();
  const typographyMap = new Map();
  const commonSpacingMap = new Map();
  const marginMap = new Map();
  const paddingMap = new Map();
  const maxWidthMap = new Map();
  const radiusMap = new Map();
  const shadowMap = new Map();
  const transitions = [];
  const animationUsages = [];
  const observedElements = (window.__designDnaIntersectionElements || []).filter(
    (element) => element instanceof Element && element.isConnected,
  );

  const colorProbe = document.createElement("span");
  colorProbe.setAttribute("aria-hidden", "true");
  colorProbe.style.cssText = "position:fixed;left:-10000px;top:-10000px;visibility:hidden;pointer-events:none";
  (document.body || document.documentElement).append(colorProbe);
  const colorCache = new Map();

  const normalizeColor = (token, computedStyle) => {
    const lowered = token.trim().toLowerCase();
    if (lowered === "currentcolor") return computedStyle.color;
    if (colorCache.has(lowered)) return colorCache.get(lowered);
    colorProbe.style.color = "";
    colorProbe.style.color = token;
    if (!colorProbe.style.color) return null;
    const normalized = getComputedStyle(colorProbe).color;
    colorCache.set(lowered, normalized);
    return normalized;
  };

  const colorTokens = (property, value) => {
    const trimmed = value.trim();
    if (!trimmed) return [];
    try {
      if (CSS.supports("color", trimmed)) return [trimmed];
    } catch {
      // Continue with token extraction.
    }
    const matches = trimmed.match(
      /#[0-9a-f]{3,8}\b|(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\([^)]*\)|\btransparent\b|\bcurrentcolor\b/gi,
    );
    return matches || [];
  };

  const colorRole = (property) => {
    if (property === "color" || property.includes("text") || property === "caret-color") return "text";
    if (property.startsWith("background")) return "background";
    if (property.includes("border") || property.includes("outline") || property.includes("column-rule")) {
      return "border";
    }
    return "accent";
  };

  const addColors = (style, selector) => {
    for (let index = 0; index < style.length; index += 1) {
      const property = style[index];
      if (
        !property.includes("color") &&
        !property.includes("shadow") &&
        property !== "fill" &&
        property !== "stroke" &&
        property !== "background-image" &&
        property !== "border-image-source" &&
        property !== "text-decoration"
      ) {
        continue;
      }
      const value = style.getPropertyValue(property);
      for (const token of colorTokens(property, value)) {
        const normalized = normalizeColor(token, style);
        if (!normalized) continue;
        const key = normalized.toLowerCase();
        let entry = colorMap.get(key);
        if (!entry) {
          entry = {
            color: normalized,
            count: 0,
            roles: new Map(),
            properties: new Map(),
            exampleSelectors: [],
          };
          colorMap.set(key, entry);
        }
        entry.count += 1;
        const role = colorRole(property);
        entry.roles.set(role, (entry.roles.get(role) || 0) + 1);
        entry.properties.set(property, (entry.properties.get(property) || 0) + 1);
        if (entry.exampleSelectors.length < maxExamples && !entry.exampleSelectors.includes(selector)) {
          entry.exampleSelectors.push(selector);
        }
      }
    }
  };

  const addTypography = (style, selector, text) => {
    if (!text) return;
    const family = style.fontFamily.trim();
    if (!family) return;
    let familyEntry = typographyMap.get(family);
    if (!familyEntry) {
      familyEntry = { family, count: 0, variants: new Map() };
      typographyMap.set(family, familyEntry);
    }
    familyEntry.count += 1;
    const variant = {
      size: style.fontSize,
      weight: style.fontWeight,
      lineHeight: style.lineHeight,
      letterSpacing: style.letterSpacing,
      fontStyle: style.fontStyle,
    };
    const key = JSON.stringify(variant);
    let variantEntry = familyEntry.variants.get(key);
    if (!variantEntry) {
      variantEntry = { ...variant, count: 0, exampleElement: selector, sampleText: text };
      familyEntry.variants.set(key, variantEntry);
    }
    variantEntry.count += 1;
  };

  const addSpacing = (style, selector) => {
    for (const side of ["top", "right", "bottom", "left"]) {
      const margin = style.getPropertyValue(`margin-${side}`);
      const padding = style.getPropertyValue(`padding-${side}`);
      const marginEntry = increment(marginMap, margin, selector);
      const paddingEntry = increment(paddingMap, padding, selector);

      let commonMargin = commonSpacingMap.get(margin);
      if (!commonMargin) {
        commonMargin = {
          value: margin,
          count: 0,
          marginCount: 0,
          paddingCount: 0,
          exampleSelectors: [],
        };
        commonSpacingMap.set(margin, commonMargin);
      }
      commonMargin.count += 1;
      commonMargin.marginCount += 1;
      if (commonMargin.exampleSelectors.length < maxExamples && !commonMargin.exampleSelectors.includes(selector)) {
        commonMargin.exampleSelectors.push(selector);
      }

      let commonPadding = commonSpacingMap.get(padding);
      if (!commonPadding) {
        commonPadding = {
          value: padding,
          count: 0,
          marginCount: 0,
          paddingCount: 0,
          exampleSelectors: [],
        };
        commonSpacingMap.set(padding, commonPadding);
      }
      commonPadding.count += 1;
      commonPadding.paddingCount += 1;
      if (commonPadding.exampleSelectors.length < maxExamples && !commonPadding.exampleSelectors.includes(selector)) {
        commonPadding.exampleSelectors.push(selector);
      }

      // Keep the variables live so malformed computed values are caught in this element's try/catch.
      void marginEntry;
      void paddingEntry;
    }

    if (style.maxWidth && style.maxWidth !== "none" && style.maxWidth !== "0px") {
      increment(maxWidthMap, style.maxWidth, selector);
    }
    const radius = style.borderRadius;
    if (radius && radius !== "0px") increment(radiusMap, radius, selector);
    if (style.boxShadow && style.boxShadow !== "none") increment(shadowMap, style.boxShadow, selector);
  };

  const hasNonZeroTime = (value) =>
    splitCssList(value).some((time) => {
      const match = time.match(/^(-?\d*\.?\d+)\s*(ms|s)$/i);
      if (!match) return false;
      return Number(match[1]) !== 0;
    });

  const addMotion = (element, style, selector) => {
    if (style.transitionProperty !== "none" && hasNonZeroTime(style.transitionDuration)) {
      transitions.push({
        selector,
        properties: splitCssList(style.transitionProperty),
        durations: splitCssList(style.transitionDuration),
        easing: splitCssList(style.transitionTimingFunction),
        delays: splitCssList(style.transitionDelay),
      });
    }

    const names = splitCssList(style.animationName).filter((name) => name && name !== "none");
    if (!names.length) return;
    const durations = splitCssList(style.animationDuration);
    const delays = splitCssList(style.animationDelay);
    const easing = splitCssList(style.animationTimingFunction);
    const iterations = splitCssList(style.animationIterationCount);
    const directions = splitCssList(style.animationDirection);
    const fillModes = splitCssList(style.animationFillMode);
    const playStates = splitCssList(style.animationPlayState);
    const timeline = style.getPropertyValue("animation-timeline") || "auto";
    const intersectionObserved = observedElements.some(
      (observed) => observed === element || observed.contains(element) || element.contains(observed),
    );

    names.forEach((name, index) => {
      animationUsages.push({
        name: name.replace(/^["']|["']$/g, ""),
        selector,
        duration: durations[index % durations.length] || null,
        delay: delays[index % delays.length] || null,
        easing: easing[index % easing.length] || null,
        iterationCount: iterations[index % iterations.length] || null,
        direction: directions[index % directions.length] || null,
        fillMode: fillModes[index % fillModes.length] || null,
        playState: playStates[index % playStates.length] || null,
        animationTimeline: timeline,
        intersectionObserved,
      });
    });
  };

  const elements = collectElements();
  let failedElements = 0;
  for (const element of elements) {
    try {
      const style = getComputedStyle(element);
      const selector = selectorFor(element);
      addColors(style, selector);
      addMotion(element, style, selector);
      if (isVisible(element, style)) {
        addTypography(style, selector, sampleText(element));
        addSpacing(style, selector);
      }

      for (const pseudo of ["::before", "::after"]) {
        const pseudoStyle = getComputedStyle(element, pseudo);
        const content = pseudoStyle.content;
        if (!content || content === "none" || pseudoStyle.display === "none") continue;
        const pseudoSelector = `${selector}${pseudo}`;
        addColors(pseudoStyle, pseudoSelector);
        addMotion(element, pseudoStyle, pseudoSelector);
        const pseudoText = content.replace(/^["']|["']$/g, "").trim();
        if (pseudoText) addTypography(pseudoStyle, pseudoSelector, pseudoText.slice(0, 160));
      }
    } catch {
      failedElements += 1;
    }
  }
  colorProbe.remove();

  if (failedElements) {
    const note = `${failedElements} DOM elements could not be inspected and were skipped.`;
    for (const notes of Object.values(fieldNotes)) notes.push(note);
  }

  const ranked = (map) => [...map.values()].sort((left, right) => right.count - left.count);
  const colors = [...colorMap.values()]
    .map((entry) => ({
      color: entry.color,
      count: entry.count,
      roles: [...entry.roles.entries()]
        .map(([role, count]) => ({ role, count }))
        .sort((left, right) => right.count - left.count),
      properties: [...entry.properties.entries()]
        .map(([property, count]) => ({ property, count }))
        .sort((left, right) => right.count - left.count),
      exampleSelectors: entry.exampleSelectors,
    }))
    .sort((left, right) => right.count - left.count);

  const typography = [...typographyMap.values()]
    .map((entry) => ({
      family: entry.family,
      count: entry.count,
      variants: [...entry.variants.values()].sort((left, right) => right.count - left.count),
    }))
    .sort((left, right) => right.count - left.count);

  return {
    colors,
    typography,
    spacing: {
      commonValues: ranked(commonSpacingMap),
      margins: ranked(marginMap),
      paddings: ranked(paddingMap),
      containerMaxWidths: ranked(maxWidthMap),
      borderRadii: ranked(radiusMap),
      boxShadows: ranked(shadowMap),
    },
    transitions,
    animationUsages,
    intersectionObservedSelectors: [...new Set(observedElements.map(selectorFor).filter(Boolean))],
    notes: fieldNotes,
    inspectedElementCount: elements.length,
  };
}

function collectPageOutline(options) {
  const maxSections = options.maxSections || 50;
  const cssEscape = (value) => (CSS?.escape ? CSS.escape(value) : String(value).replace(/\W/g, "\\$&"));
  const selectorFor = (element) => {
    if (element.id) return `#${cssEscape(element.id)}`;
    const segments = [];
    let current = element;
    while (current && current !== document.documentElement && segments.length < 5) {
      let segment = current.localName;
      const classes = [...current.classList]
        .filter((name) => name.length < 80 && !/[\d]{5,}/.test(name))
        .slice(0, 2);
      if (classes.length) segment += classes.map((name) => `.${cssEscape(name)}`).join("");
      else if (current.parentElement) {
        const peers = [...current.parentElement.children].filter((peer) => peer.localName === current.localName);
        if (peers.length > 1) segment += `:nth-of-type(${peers.indexOf(current) + 1})`;
      }
      segments.unshift(segment);
      current = current.parentElement;
    }
    return segments.join(" > ") || element.localName;
  };

  const visible = (element) => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
  };

  const candidates = new Set();
  const semanticSelector = [
    "header",
    "nav",
    "main",
    "footer",
    "section",
    "article",
    '[role="banner"]',
    '[role="navigation"]',
    '[role="main"]',
    '[role="contentinfo"]',
    '[role="region"]',
  ].join(",");
  document.querySelectorAll(semanticSelector).forEach((element) => candidates.add(element));
  document.querySelectorAll("body > *, main > *").forEach((element) => {
    if (/^(SCRIPT|STYLE|LINK|META|NOSCRIPT|TEMPLATE)$/.test(element.tagName)) return;
    const rect = element.getBoundingClientRect();
    if (rect.height >= 80) candidates.add(element);
  });
  document.querySelectorAll('[class*="hero" i], [id*="hero" i], [class*="masthead" i], [id*="masthead" i]').forEach(
    (element) => candidates.add(element),
  );

  const totalCandidates = candidates.size;
  const visibleCandidates = [...candidates].filter(visible);
  const viewportWidth = document.documentElement.clientWidth || innerWidth;
  const isMajorCandidate = (element) => {
    const tag = element.localName;
    const role = (element.getAttribute("role") || "").toLowerCase();
    const parent = element.parentElement;
    const rect = element.getBoundingClientRect();
    const identity = `${element.id || ""} ${String(element.className || "")}`.toLowerCase();
    const ancestorBoundary = parent?.closest('section,article,[role="region"]') || null;
    const wide = rect.width >= viewportWidth * 0.72;

    if (tag === "header" || role === "banner") {
      return !parent?.closest('header,[role="banner"]');
    }
    if (tag === "footer" || role === "contentinfo") {
      return !parent?.closest('footer,[role="contentinfo"]');
    }
    if (tag === "main" || role === "main") {
      return !parent?.closest('main,[role="main"]');
    }
    if (tag === "nav" || role === "navigation") {
      if (parent?.closest('nav,[role="navigation"]') || parent?.closest("aside")) return false;
      const headerAncestor = parent?.closest('header,[role="banner"]');
      const contentAncestor = parent?.closest('section,article,footer,[role="region"],[role="contentinfo"]');
      return Boolean(headerAncestor) || (wide && !contentAncestor);
    }
    if (tag === "section" || role === "region") return !ancestorBoundary;
    if (tag === "article") return !ancestorBoundary;

    const explicitHero = /\b(hero|masthead|jumbotron)\b/.test(identity);
    if (explicitHero) {
      return !ancestorBoundary && wide && rect.height >= innerHeight * 0.3;
    }

    const directStructuralChild = Boolean(parent?.matches('body,main,[role="main"]'));
    if (!directStructuralChild || !wide || rect.height < 80) return false;
    const wrapsMajorBoundaries = Boolean(
      element.querySelector('main,section,article,[role="main"],[role="region"]'),
    );
    return !wrapsMajorBoundaries;
  };

  const majorCandidates = visibleCandidates.filter(isMajorCandidate);
  const fallbackCandidates =
    majorCandidates.length === 0 && visibleCandidates.length > 0
      ? [...visibleCandidates]
          .sort((left, right) => {
            const leftRect = left.getBoundingClientRect();
            const rightRect = right.getBoundingClientRect();
            return rightRect.width * rightRect.height - leftRect.width * leftRect.height;
          })
          .slice(0, Math.min(5, maxSections))
      : [];
  const selectedCandidates = majorCandidates.length > 0 ? majorCandidates : fallbackCandidates;
  const ordered = selectedCandidates
    .sort((left, right) => {
      if (left === right) return 0;
      const position = left.compareDocumentPosition(right);
      if (position & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
      if (position & Node.DOCUMENT_POSITION_PRECEDING) return 1;
      return 0;
    })
    .slice(0, maxSections);

  const kindFor = (element) => {
    const tag = element.localName;
    const role = element.getAttribute("role") || "";
    const identity = `${element.id || ""} ${String(element.className || "")}`.toLowerCase();
    if (tag === "header" || role === "banner") return "header";
    if (tag === "nav" || role === "navigation") return "nav";
    if (tag === "footer" || role === "contentinfo") return "footer";
    if (tag === "main" || role === "main") return "main";
    if (/\b(hero|masthead|jumbotron)\b/.test(identity)) return "hero";
    const rect = element.getBoundingClientRect();
    if (
      rect.width >= viewportWidth * 0.72 &&
      rect.top < innerHeight * 0.8 &&
      rect.bottom > innerHeight * 0.15 &&
      rect.height >= innerHeight * 0.45 &&
      rect.height <= innerHeight * 2.5
    ) {
      return "hero";
    }
    if (tag === "article") return "article";
    return "section";
  };

  const imageUrls = (value) => {
    const urls = [];
    const pattern = /url\(\s*(?:"([^"]+)"|'([^']+)'|([^)'"\s]+))\s*\)/gi;
    let match;
    while ((match = pattern.exec(value))) urls.push(match[1] || match[2] || match[3]);
    return urls;
  };

  const canvasContexts = window.__designDnaCanvasContexts || [];
  const contextTypesFor = (canvas) => [
    ...new Set(
      canvasContexts
        .filter((entry) => entry.element === canvas)
        .map((entry) => entry.type)
        .filter(Boolean),
    ),
  ];

  const sectionItems = [];
  const backgroundItems = [];
  const heroMedia = [];
  let failedCandidates = 0;

  ordered.forEach((element, index) => {
    try {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const selector = selectorFor(element);
      const kind = kindFor(element);
      const headings = [...element.querySelectorAll("h1,h2,h3")]
        .slice(0, 3)
        .map((heading) => heading.textContent.replace(/\s+/g, " ").trim())
        .filter(Boolean);
      const counts = {
        directChildren: element.children.length,
        headings: element.querySelectorAll("h1,h2,h3,h4,h5,h6").length,
        links: element.querySelectorAll("a[href]").length,
        buttons: element.querySelectorAll('button, [role="button"]').length,
        images: element.querySelectorAll("img,picture").length,
      };
      const descriptionParts = [];
      if (headings.length) descriptionParts.push(`headed “${headings[0].slice(0, 100)}”`);
      descriptionParts.push(`${counts.directChildren} direct child${counts.directChildren === 1 ? "" : "ren"}`);
      const contentCounts = [];
      if (counts.links) contentCounts.push(`${counts.links} link${counts.links === 1 ? "" : "s"}`);
      if (counts.buttons) contentCounts.push(`${counts.buttons} button${counts.buttons === 1 ? "" : "s"}`);
      if (counts.images) contentCounts.push(`${counts.images} image${counts.images === 1 ? "" : "s"}`);
      if (contentCounts.length) descriptionParts.push(contentCounts.join(", "));

      sectionItems.push({
        kind,
        selector,
        tag: element.localName,
        id: element.id || null,
        classes: [...element.classList],
        role: element.getAttribute("role"),
        approximateHeight: Math.round(rect.height),
        approximateWidth: Math.round(rect.width),
        documentTop: Math.round(rect.top + scrollY),
        headings,
        keyComputedStyles: {
          display: style.display,
          position: style.position,
          color: style.color,
          backgroundColor: style.backgroundColor,
          backgroundImage: style.backgroundImage,
          fontFamily: style.fontFamily,
          fontSize: style.fontSize,
          margin: style.margin,
          padding: style.padding,
          maxWidth: style.maxWidth,
          borderRadius: style.borderRadius,
          boxShadow: style.boxShadow,
          overflow: style.overflow,
        },
        structure: counts,
        description: `${kind} ${descriptionParts.join("; ")}.`,
      });

      backgroundItems.push({
        sectionSelector: selector,
        sectionKind: kind,
        backgroundColor: style.backgroundColor,
        backgroundImage: style.backgroundImage,
        imageUrls: imageUrls(style.backgroundImage),
        backgroundSize: style.backgroundSize,
        backgroundPosition: style.backgroundPosition,
        backgroundRepeat: style.backgroundRepeat,
        backgroundAttachment: style.backgroundAttachment,
        backgroundOrigin: style.backgroundOrigin,
        backgroundClip: style.backgroundClip,
        backgroundBlendMode: style.backgroundBlendMode,
        mixBlendMode: style.mixBlendMode,
        filter: style.filter,
        backdropFilter: style.backdropFilter || style.getPropertyValue("-webkit-backdrop-filter") || "none",
      });

      const isHeroArea = kind === "hero" || (rect.top < innerHeight * 1.5 && rect.bottom > 0);
      if (isHeroArea) {
        const mediaElements = [];
        if (element.matches("video,canvas")) mediaElements.push(element);
        mediaElements.push(...element.querySelectorAll("video,canvas"));
        for (const media of new Set(mediaElements)) {
          const mediaRect = media.getBoundingClientRect();
          if (media instanceof HTMLVideoElement) {
            heroMedia.push({
              type: "video",
              selector: selectorFor(media),
              sectionSelector: selector,
              approximateWidth: Math.round(mediaRect.width),
              approximateHeight: Math.round(mediaRect.height),
              sourceUrls: [
                media.currentSrc,
                media.src,
                ...[...media.querySelectorAll("source")].map((source) => source.src),
              ].filter(Boolean),
              autoplay: media.autoplay,
              muted: media.muted,
              loop: media.loop,
              playsInline: media.playsInline,
              poster: media.poster || null,
            });
          } else if (media instanceof HTMLCanvasElement) {
            const contextTypes = contextTypesFor(media);
            heroMedia.push({
              type: contextTypes.some((type) => type === "webgl" || type === "webgl2") ? "webgl-canvas" : "canvas",
              selector: selectorFor(media),
              sectionSelector: selector,
              approximateWidth: Math.round(mediaRect.width),
              approximateHeight: Math.round(mediaRect.height),
              bitmapWidth: media.width,
              bitmapHeight: media.height,
              observedContextTypes: contextTypes,
            });
          }
        }
      }
    } catch {
      // A single malformed custom element must not suppress the rest of the outline.
      failedCandidates += 1;
    }
  });

  const notes = [];
  const hiddenCandidates = totalCandidates - visibleCandidates.length;
  const prunedCandidates = visibleCandidates.length - selectedCandidates.length;
  if (hiddenCandidates > 0) {
    notes.push(`${hiddenCandidates} of ${totalCandidates} discovered outline candidates were hidden or zero-size.`);
  }
  if (prunedCandidates > 0) {
    notes.push(
      `Top-level outline selected ${selectedCandidates.length} of ${visibleCandidates.length} visible candidates; ` +
        `${prunedCandidates} nested or minor candidates were omitted.`,
    );
  }
  if (fallbackCandidates.length > 0) {
    notes.push(
      `No visible candidates passed the top-level outline filter; kept the ${fallbackCandidates.length} largest visible ` +
        `candidate${fallbackCandidates.length === 1 ? "" : "s"} as a fallback.`,
    );
  }
  if (majorCandidates.length > maxSections) {
    notes.push(`Top-level outline was capped at ${maxSections} of ${majorCandidates.length} major candidates.`);
  }
  if (failedCandidates) {
    notes.push(`${failedCandidates} section candidate(s) could not be inspected and were skipped.`);
  }

  return {
    sections: sectionItems,
    totalCandidates,
    backgrounds: backgroundItems,
    heroMedia,
    notes,
  };
}

function collectInlineSvgs(options) {
  const maxInlineBytes = options.maxInlineBytes || 4096;
  const encoder = new TextEncoder();
  const cssEscape = (value) => (CSS?.escape ? CSS.escape(value) : String(value).replace(/\W/g, "\\$&"));
  const selectorFor = (element) => {
    if (element.id) return `#${cssEscape(element.id)}`;
    const classes = [...element.classList].slice(0, 2).map((name) => `.${cssEscape(name)}`).join("");
    const base = `${element.localName}${classes}`;
    const matches = [...document.querySelectorAll("svg")].filter(
      (svg) => svg.localName === element.localName && [...element.classList].every((name) => svg.classList.contains(name)),
    );
    return matches.length > 1 ? `${base}:nth-of-type(${Math.max(1, [...element.parentElement.children].indexOf(element) + 1)})` : base;
  };

  const inferRole = (svg) => {
    const explicit = svg.getAttribute("role");
    if (explicit) return explicit;
    if (svg.getAttribute("aria-hidden") === "true") return "decorative";
    if (svg.getAttribute("aria-label") || svg.querySelector("title")) return "image";
    if (svg.closest("button,a")) return "icon";
    return "graphic";
  };

  return [...document.querySelectorAll("svg")].map((svg) => {
    const markup = svg.outerHTML;
    const byteSize = encoder.encode(markup).byteLength;
    const rect = svg.getBoundingClientRect();
    const base = {
      kind: byteSize < maxInlineBytes ? "verbatim" : "summary",
      selector: selectorFor(svg),
      id: svg.id || null,
      classes: [...svg.classList],
      byteSize,
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      viewBox: svg.getAttribute("viewBox"),
      role: inferRole(svg),
      accessibleName: svg.getAttribute("aria-label") || svg.querySelector("title")?.textContent?.trim() || null,
    };
    if (byteSize < maxInlineBytes) base.markup = markup;
    return base;
  });
}

function collectStylesheetInventory() {
  const descriptors = [];
  const cssom = { keyframes: [], mediaQueries: [], stateRules: [], timelineRules: [], notes: [] };
  const visited = new Set();
  const inlineSources = new WeakMap();
  let inlineIndex = 0;

  const sourceFor = (sheet) => {
    if (sheet.href) return sheet.href;
    const owner = sheet.ownerNode;
    if (owner instanceof HTMLStyleElement) {
      if (!inlineSources.has(owner)) {
        inlineIndex += 1;
        inlineSources.set(owner, `inline://document/style-${inlineIndex}`);
      }
      return inlineSources.get(owner);
    }
    return `cssom://adopted-${descriptors.length + 1}`;
  };

  const walkRuleList = (rules, source) => {
    for (const rule of rules) {
      const cssText = rule.cssText || "";
      if (/^@(?:-[a-z]+-)?keyframes\b/i.test(cssText) && "name" in rule) {
        cssom.keyframes.push({
          name: rule.name,
          vendorPrefix: cssText.match(/^@(-[a-z]+-)?keyframes/i)?.[1] || null,
          cssText,
          source,
        });
        continue;
      }
      if (/^@media\b/i.test(cssText) && rule.media) {
        cssom.mediaQueries.push({ condition: rule.conditionText || rule.media.mediaText, cssText, source });
      }
      if (rule.selectorText && /:(hover|focus|focus-visible|active)\b/i.test(rule.selectorText) && /animation(?:-name)?\s*:/.test(cssText)) {
        cssom.stateRules.push({
          selector: rule.selectorText,
          declarations: rule.style?.cssText || cssText,
          cssText,
          source,
        });
      }
      if (rule.selectorText && /animation-timeline\s*:|scroll-timeline\s*:|view-timeline\s*:/i.test(cssText)) {
        cssom.timelineRules.push({
          selector: rule.selectorText,
          declarations: rule.style?.cssText || cssText,
          cssText,
          source,
        });
      }
      if (rule.cssRules) {
        try {
          walkRuleList(rule.cssRules, source);
        } catch (error) {
          cssom.notes.push(`${source}: nested CSS rules inaccessible: ${error.message}`);
        }
      }
      if (rule.styleSheet) walkSheet(rule.styleSheet, rule.href || source);
    }
  };

  const walkSheet = (sheet, forcedSource) => {
    if (!sheet || visited.has(sheet)) return;
    visited.add(sheet);
    const source = forcedSource || sourceFor(sheet);
    const descriptor = {
      source,
      href: sheet.href || null,
      media: sheet.media?.mediaText || "all",
      disabled: Boolean(sheet.disabled),
      cssomAccessible: false,
      inlineCssText: null,
      error: null,
    };
    if (!sheet.href && sheet.ownerNode instanceof HTMLStyleElement) {
      descriptor.inlineCssText = sheet.ownerNode.textContent || "";
    }
    descriptors.push(descriptor);
    try {
      const rules = sheet.cssRules;
      descriptor.cssomAccessible = true;
      walkRuleList(rules, source);
    } catch (error) {
      descriptor.error = error.message;
      cssom.notes.push(`${source}: CSSOM access failed (${error.message}); raw fetch will be attempted.`);
    }
  };

  for (const sheet of document.styleSheets) walkSheet(sheet);
  for (const sheet of document.adoptedStyleSheets || []) walkSheet(sheet);
  const walkShadowRoots = (root) => {
    for (const element of root.querySelectorAll("*")) {
      if (!element.shadowRoot) continue;
      for (const style of element.shadowRoot.querySelectorAll("style,link[rel~='stylesheet']")) {
        if (style.sheet) walkSheet(style.sheet);
      }
      for (const sheet of element.shadowRoot.adoptedStyleSheets || []) walkSheet(sheet);
      walkShadowRoots(element.shadowRoot);
    }
  };
  walkShadowRoots(document);

  return { descriptors, cssom };
}

function decodeDataStylesheet(url) {
  const comma = url.indexOf(",");
  if (comma === -1) throw new Error("Malformed data URL");
  const metadata = url.slice(5, comma);
  const body = url.slice(comma + 1);
  if (/;base64(?:;|$)/i.test(metadata)) return Buffer.from(body, "base64").toString("utf8");
  return decodeURIComponent(body);
}

async function loadStylesheetText(context, url, networkCssBodies) {
  if (url.startsWith("data:")) return { text: decodeDataStylesheet(url), method: "data-url", statusCode: 200 };
  if (url.startsWith("blob:")) throw new Error("blob: stylesheet cannot be fetched outside the page");

  const withoutHash = url.replace(/#.*$/, "");
  const captured = networkCssBodies.get(url) || networkCssBodies.get(withoutHash);
  if (captured) {
    const result = await captured;
    if (result.error) throw new Error(result.error);
    return { text: result.text, method: "navigation-response", statusCode: result.statusCode };
  }

  const response = await context.request.get(url, { timeout: 30_000, failOnStatusCode: false });
  if (!response.ok()) throw new Error(`HTTP ${response.status()} ${response.statusText()}`);
  return { text: await response.text(), method: "browser-request", statusCode: response.status() };
}

async function gatherRawStylesheets(context, inventory, networkCssBodies, pageUrl) {
  const notes = [];
  const parsedSources = [];
  const stylesheets = [];
  const queued = new Map();
  const pageOrigin = new URL(pageUrl).origin;

  for (const descriptor of inventory.descriptors) {
    if (descriptor.inlineCssText !== null) {
      queued.set(descriptor.source, {
        source: descriptor.source,
        baseUrl: pageUrl,
        text: descriptor.inlineCssText,
        method: "inline",
        statusCode: null,
        origin: "document",
      });
    } else if (descriptor.href) {
      queued.set(descriptor.href, {
        source: descriptor.href,
        baseUrl: descriptor.href,
        text: null,
        method: null,
        statusCode: null,
        origin: "document",
      });
    } else if (descriptor.cssomAccessible) {
      stylesheets.push({
        source: descriptor.source,
        origin: "document",
        crossOrigin: false,
        status: "parsed",
        method: "cssom",
        statusCode: null,
        bytes: null,
        error: null,
      });
    }
  }

  const processed = new Set();
  while (processed.size < queued.size && processed.size < MAX_STYLESHEETS) {
    const next = [...queued.values()].find((entry) => !processed.has(entry.source));
    if (!next) break;
    processed.add(next.source);
    let text = next.text;
    let method = next.method;
    let statusCode = next.statusCode;
    let fetchError = null;

    if (text === null) {
      try {
        const loaded = await loadStylesheetText(context, next.source, networkCssBodies);
        text = loaded.text;
        method = loaded.method;
        statusCode = loaded.statusCode;
      } catch (error) {
        fetchError = errorMessage(error);
      }
    }

    let crossOrigin = false;
    try {
      crossOrigin = new URL(next.source, pageUrl).origin !== pageOrigin;
    } catch {
      // Synthetic inline and adopted-sheet URLs do not have a meaningful origin.
    }

    if (fetchError) {
      const note = `${next.source}: raw stylesheet fetch failed (${fetchError}); CSSOM fallback retained when available.`;
      notes.push(note);
      stylesheets.push({
        source: next.source,
        origin: next.origin,
        crossOrigin,
        status: "failed",
        method: method || "fetch",
        statusCode,
        bytes: null,
        error: fetchError,
      });
      continue;
    }

    const bytes = Buffer.byteLength(text, "utf8");
    if (bytes > MAX_STYLESHEET_BYTES) {
      const note = `${next.source}: skipped because it is ${bytes} bytes (limit ${MAX_STYLESHEET_BYTES}).`;
      notes.push(note);
      stylesheets.push({
        source: next.source,
        origin: next.origin,
        crossOrigin,
        status: "skipped",
        method,
        statusCode,
        bytes,
        error: note,
      });
      continue;
    }

    let parsed;
    try {
      parsed = parseCssText(text, next.source);
    } catch (error) {
      const note = `${next.source}: CSS parser failed (${errorMessage(error)}).`;
      notes.push(note);
      stylesheets.push({
        source: next.source,
        origin: next.origin,
        crossOrigin,
        status: "failed",
        method,
        statusCode,
        bytes,
        error: errorMessage(error),
      });
      continue;
    }

    parsedSources.push({ source: next.source, parsed });
    notes.push(...parsed.notes);
    stylesheets.push({
      source: next.source,
      origin: next.origin,
      crossOrigin,
      status: "parsed",
      method,
      statusCode,
      bytes,
      error: null,
    });

    for (const imported of parsed.imports) {
      let importedUrl;
      try {
        importedUrl = new URL(imported.rawUrl, next.baseUrl).href;
      } catch (error) {
        notes.push(`${next.source}: could not resolve @import ${imported.rawUrl} (${errorMessage(error)}).`);
        continue;
      }
      if (!/^(https?:|data:|blob:)/i.test(importedUrl)) {
        notes.push(`${next.source}: skipped unsupported @import URL ${importedUrl}.`);
        continue;
      }
      if (!queued.has(importedUrl)) {
        queued.set(importedUrl, {
          source: importedUrl,
          baseUrl: importedUrl,
          text: null,
          method: null,
          statusCode: null,
          origin: "@import",
        });
      }
    }
  }

  if (queued.size > MAX_STYLESHEETS) {
    notes.push(`Stylesheet traversal stopped at ${MAX_STYLESHEETS} sources (${queued.size} discovered).`);
  }
  return { parsedSources, stylesheets, notes };
}

function preferRawOccurrences(rawSources, cssom, key) {
  const raw = rawSources.flatMap(({ parsed }) => parsed[key]);
  const sourcesWithRawText = new Set(rawSources.map(({ source }) => source));
  const fallback = cssom[key].filter((item) => !sourcesWithRawText.has(item.source));
  const seen = new Set();
  return [...raw, ...fallback].filter((item) => {
    const identity = `${item.source}\u0000${item.name || item.condition || item.selector || ""}\u0000${item.cssText}`;
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

function buildBreakpoints(rawSources, cssom) {
  const items = preferRawOccurrences(rawSources, cssom, "mediaQueries").map((item) => ({
    condition: item.condition,
    widths: mediaWidths(item.condition),
    source: item.source,
    cssText: item.cssText,
  }));
  const summaryMap = new Map();
  for (const item of items) {
    let summary = summaryMap.get(item.condition);
    if (!summary) {
      summary = { condition: item.condition, count: 0, widths: item.widths, sources: [] };
      summaryMap.set(item.condition, summary);
    }
    summary.count += 1;
    if (!summary.sources.includes(item.source)) summary.sources.push(item.source);
  }
  return {
    items,
    summary: [...summaryMap.values()].sort((left, right) => right.count - left.count),
  };
}

function buildAnimations(rawSources, cssom, computed) {
  const keyframes = preferRawOccurrences(rawSources, cssom, "keyframes");
  const stateRules = preferRawOccurrences(rawSources, cssom, "stateRules");
  const timelineRules = preferRawOccurrences(rawSources, cssom, "timelineRules");
  const allNames = new Set(keyframes.map((item) => item.name));

  const enriched = keyframes.map((keyframe) => {
    const uses = computed.animationUsages.filter((usage) => usage.name === keyframe.name);
    const ruleUsages = [];
    const triggerEvidence = [];

    for (const rule of stateRules) {
      if (!mentionsKeyframe(rule.declarations, keyframe.name)) continue;
      const triggers = triggerForSelector(rule.selector);
      ruleUsages.push({ selector: rule.selector, source: rule.source, triggers });
      for (const trigger of triggers) {
        triggerEvidence.push({ type: trigger, evidence: `CSS selector ${rule.selector}`, source: rule.source });
      }
    }
    for (const rule of timelineRules) {
      if (!mentionsKeyframe(rule.declarations, keyframe.name)) continue;
      ruleUsages.push({ selector: rule.selector, source: rule.source, triggers: ["scroll"] });
      triggerEvidence.push({
        type: "scroll",
        evidence: `CSS animation/scroll/view timeline on ${rule.selector}`,
        source: rule.source,
      });
    }
    for (const usage of uses) {
      if (usage.intersectionObserved) {
        triggerEvidence.push({
          type: "scroll",
          evidence: `IntersectionObserver observed ${usage.selector}`,
          source: "runtime",
        });
      }
      if (usage.animationTimeline && !new Set(["auto", "none"]).has(usage.animationTimeline.trim())) {
        triggerEvidence.push({
          type: "scroll",
          evidence: `Computed animation-timeline: ${usage.animationTimeline} on ${usage.selector}`,
          source: "runtime",
        });
      }
    }

    const stateOrScrollTriggers = new Set(triggerEvidence.map((item) => item.type));
    if (uses.length && stateOrScrollTriggers.size === 0) {
      triggerEvidence.push({
        type: "load",
        evidence: "Animation was active in computed style after initial page load.",
        source: "runtime",
      });
    }
    const evidenceSeen = new Set();
    const dedupedEvidence = triggerEvidence.filter((item) => {
      const identity = `${item.type}\u0000${item.evidence}\u0000${item.source}`;
      if (evidenceSeen.has(identity)) return false;
      evidenceSeen.add(identity);
      return true;
    });

    return {
      name: keyframe.name,
      vendorPrefix: keyframe.vendorPrefix,
      source: keyframe.source,
      cssText: keyframe.cssText,
      uses,
      ruleUsages,
      likelyTriggers: [...new Set(dedupedEvidence.map((item) => item.type))],
      triggerEvidence: dedupedEvidence,
    };
  });

  return {
    keyframes: enriched,
    transitions: computed.transitions,
    unmatchedAnimationUses: computed.animationUsages.filter((usage) => !allNames.has(usage.name)),
    intersectionObserverHints: computed.intersectionObservedSelectors,
  };
}

function emptyComputedResult() {
  return {
    colors: [],
    typography: [],
    spacing: {
      commonValues: [],
      margins: [],
      paddings: [],
      containerMaxWidths: [],
      borderRadii: [],
      boxShadows: [],
    },
    transitions: [],
    animationUsages: [],
    intersectionObservedSelectors: [],
    notes: { colors: [], typography: [], spacing: [], animations: [] },
    inspectedElementCount: 0,
  };
}

function emptyCapture(url) {
  return {
    schemaVersion: SCHEMA_VERSION,
    meta: {
      url,
      requestedUrl: url,
      title: null,
      viewport: { ...VIEWPORT, deviceScaleFactor: 1 },
      timestamp: new Date().toISOString(),
      document: null,
      navigation: null,
      notes: [],
    },
    colors: { items: [], inspectedElementCount: 0, notes: [] },
    typography: { families: [], notes: [] },
    spacing: {
      commonValues: [],
      margins: [],
      paddings: [],
      containerMaxWidths: [],
      borderRadii: [],
      boxShadows: [],
      notes: [],
    },
    breakpoints: { items: [], summary: [], stylesheets: [], notes: [] },
    animations: {
      keyframes: [],
      transitions: [],
      unmatchedAnimationUses: [],
      intersectionObserverHints: [],
      notes: [],
    },
    backgrounds: { sections: [], heroMedia: [], notes: [] },
    inlineSvgs: { thresholdBytes: 4096, items: [], notes: [] },
    sections: { items: [], totalCandidates: 0, notes: [] },
    notes: [],
  };
}

/**
 * Render a URL in headless Chromium and return a serializable visual-design capture.
 * Every non-fatal extraction error is recorded in the affected field's notes array.
 *
 * @param {string} url absolute http(s) URL
 * @returns {Promise<object>} design capture matching docs/capture-schema.md
 */
export async function extractDesign(url) {
  const parsedUrl = new URL(url);
  if (!new Set(["http:", "https:"]).has(parsedUrl.protocol)) {
    throw new Error("extractDesign only supports http:// and https:// URLs");
  }

  const capture = emptyCapture(parsedUrl.href);
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
  } catch (error) {
    throw new Error(`Chromium launch failed: ${errorMessage(error)}`);
  }

  try {
    const context = await browser.newContext({
      viewport: VIEWPORT,
      deviceScaleFactor: 1,
      colorScheme: "light",
      reducedMotion: "no-preference",
      locale: "en-US",
    });
    const page = await context.newPage();
    await page.addInitScript(instrumentPage);

    const networkCssBodies = new Map();
    const pendingCssResponses = new Set();
    page.on("response", (response) => {
      const contentType = response.headers()["content-type"] || "";
      if (response.request().resourceType() !== "stylesheet" && !contentType.includes("text/css")) return;
      const responseUrl = response.url();
      const promise = response
        .text()
        .then((text) => ({ text, statusCode: response.status(), error: null }))
        .catch((error) => ({ text: null, statusCode: response.status(), error: errorMessage(error) }));
      networkCssBodies.set(responseUrl, promise);
      networkCssBodies.set(responseUrl.replace(/#.*$/, ""), promise);
      pendingCssResponses.add(promise);
      promise.finally(() => pendingCssResponses.delete(promise));
    });

    let navigationResponse = null;
    try {
      navigationResponse = await page.goto(parsedUrl.href, {
        waitUntil: "domcontentloaded",
        timeout: 60_000,
      });
      capture.meta.navigation = navigationResponse
        ? { status: navigationResponse.status(), statusText: navigationResponse.statusText() }
        : { status: null, statusText: "Navigation returned no main-resource response" };
    } catch (error) {
      capture.meta.notes.push(`Navigation did not fully complete: ${errorMessage(error)}`);
    }

    await safely(capture.meta.notes, "Network-idle wait", null, () =>
      page.waitForLoadState("networkidle", { timeout: 10_000 }),
    );
    await page.waitForTimeout(1_500);
    await safely(capture.typography.notes, "Web-font readiness wait", null, () =>
      page.evaluate(() => Promise.race([document.fonts.ready, new Promise((resolve) => setTimeout(resolve, 8_000))])),
    );

    const meta = await safely(capture.meta.notes, "Document metadata extraction", null, () =>
      page.evaluate(() => ({
        url: location.href,
        title: document.title,
        viewport: {
          width: innerWidth,
          height: innerHeight,
          deviceScaleFactor: devicePixelRatio,
        },
        document: {
          language: document.documentElement.lang || null,
          scrollWidth: document.documentElement.scrollWidth,
          scrollHeight: document.documentElement.scrollHeight,
          contentType: document.contentType,
        },
      })),
    );
    if (meta) {
      capture.meta.url = meta.url;
      capture.meta.title = meta.title;
      capture.meta.viewport = meta.viewport;
      capture.meta.document = meta.document;
    }

    const computedEvaluationNotes = [];
    const computed = await safely(
      computedEvaluationNotes,
      "Computed-style extraction",
      emptyComputedResult(),
      () => page.evaluate(collectComputedDesign, { maxExamples: MAX_EXAMPLE_SELECTORS }),
    );
    capture.colors.items = computed.colors;
    capture.colors.inspectedElementCount = computed.inspectedElementCount;
    capture.colors.notes.push(...computedEvaluationNotes, ...computed.notes.colors);
    capture.typography.families = computed.typography;
    capture.typography.notes.push(...computedEvaluationNotes, ...computed.notes.typography);
    Object.assign(capture.spacing, computed.spacing);
    capture.spacing.notes.push(...computedEvaluationNotes, ...computed.notes.spacing);
    capture.animations.notes.push(...computedEvaluationNotes, ...computed.notes.animations);

    const outlineEvaluationNotes = [];
    const outline = await safely(
      outlineEvaluationNotes,
      "Section/background extraction",
      { sections: [], totalCandidates: 0, backgrounds: [], heroMedia: [], notes: [] },
      () => page.evaluate(collectPageOutline, { maxSections: 50 }),
    );
    capture.sections.items = outline.sections;
    capture.sections.totalCandidates = outline.totalCandidates;
    capture.sections.notes.push(...outlineEvaluationNotes, ...outline.notes);
    capture.backgrounds.sections = outline.backgrounds;
    capture.backgrounds.heroMedia = outline.heroMedia;
    capture.backgrounds.notes.push(...outlineEvaluationNotes, ...outline.notes);

    capture.inlineSvgs.items = await safely(
      capture.inlineSvgs.notes,
      "Inline SVG extraction",
      [],
      () => page.evaluate(collectInlineSvgs, { maxInlineBytes: capture.inlineSvgs.thresholdBytes }),
    );

    const stylesheetEvaluationNotes = [];
    const inventory = await safely(
      stylesheetEvaluationNotes,
      "Stylesheet inventory",
      {
        descriptors: [],
        cssom: { keyframes: [], mediaQueries: [], stateRules: [], timelineRules: [], notes: [] },
      },
      () => page.evaluate(collectStylesheetInventory),
    );
    capture.breakpoints.notes.push(...stylesheetEvaluationNotes, ...inventory.cssom.notes);
    capture.animations.notes.push(...stylesheetEvaluationNotes, ...inventory.cssom.notes);

    await Promise.allSettled([...pendingCssResponses]);
    const rawStylesheetEvaluationNotes = [];
    const raw = await safely(
      rawStylesheetEvaluationNotes,
      "Raw stylesheet traversal",
      { parsedSources: [], stylesheets: [], notes: [] },
      () => gatherRawStylesheets(context, inventory, networkCssBodies, capture.meta.url),
    );
    capture.breakpoints.stylesheets = raw.stylesheets;
    capture.breakpoints.notes.push(...rawStylesheetEvaluationNotes, ...raw.notes);
    capture.animations.notes.push(...rawStylesheetEvaluationNotes, ...raw.notes);

    const breakpointData = await safely(
      capture.breakpoints.notes,
      "Media-query aggregation",
      { items: [], summary: [] },
      async () => buildBreakpoints(raw.parsedSources, inventory.cssom),
    );
    capture.breakpoints.items = breakpointData.items;
    capture.breakpoints.summary = breakpointData.summary;

    const animationData = await safely(
      capture.animations.notes,
      "Animation aggregation",
      {
        keyframes: [],
        transitions: computed.transitions,
        unmatchedAnimationUses: computed.animationUsages,
        intersectionObserverHints: computed.intersectionObservedSelectors,
      },
      async () => buildAnimations(raw.parsedSources, inventory.cssom, computed),
    );
    Object.assign(capture.animations, animationData);
    capture.animations.notes.push(
      "Trigger labels are heuristics based on loaded computed styles, state selectors, IntersectionObserver activity, and CSS animation timelines.",
    );

    const childFrames = page.frames().filter((frame) => frame !== page.mainFrame());
    if (childFrames.length) {
      const note = `${childFrames.length} iframe document(s) were detected; the capture covers the top-level document only.`;
      capture.sections.notes.push(note);
      capture.notes.push(note);
    }
    capture.meta.timestamp = new Date().toISOString();
    await context.close();
  } catch (error) {
    capture.notes.push(`Unexpected top-level extraction error: ${errorMessage(error)}`);
  } finally {
    await browser.close().catch(() => {});
  }

  return capture;
}

// Kept outside the documented package API; exported so the pure extraction logic can be tested
// without starting a browser.
export const __internal = Object.freeze({
  parseCssText,
  mediaWidths,
  buildBreakpoints,
  buildAnimations,
  collectComputedDesign,
  collectPageOutline,
});
