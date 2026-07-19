const SUPPORTED_SCHEMA_VERSION = "1.0.0";

const SECTION_STYLE_PROPERTIES = [
  "display",
  "position",
  "color",
  "backgroundColor",
  "backgroundImage",
  "fontFamily",
  "fontSize",
  "margin",
  "padding",
  "maxWidth",
  "borderRadius",
  "boxShadow",
  "overflow",
];

function array(value) {
  return Array.isArray(value) ? value : [];
}

function present(value) {
  return value !== null && value !== undefined && value !== "";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function markdownText(value) {
  return escapeHtml(value).replace(/([\\`*_[\]|])/g, "\\$1");
}

function markdownCell(value) {
  if (!present(value)) return "—";
  return escapeHtml(value).replaceAll("|", "&#124;").replace(/\r?\n/g, "<br>");
}

function htmlCode(value) {
  return `<code>${escapeHtml(present(value) ? value : "—")}</code>`;
}

function markdownTable(headers, rows) {
  const header = `| ${headers.map(markdownCell).join(" | ")} |`;
  const divider = `| ${headers.map(() => "---").join(" | ")} |`;
  const body = rows.map((row) => `| ${row.map(markdownCell).join(" | ")} |`);
  return [header, divider, ...body].join("\n");
}

function fenced(code, language = "") {
  const source = String(code ?? "");
  const longestRun = Math.max(0, ...Array.from(source.matchAll(/`+/g), (match) => match[0].length));
  const fence = "`".repeat(Math.max(3, longestRun + 1));
  return `${fence}${language}\n${source}${source.endsWith("\n") ? "" : "\n"}${fence}`;
}

function unique(values) {
  return [...new Set(values.filter(present).map(String))];
}

function joinValues(values, separator = ", ") {
  const result = unique(array(values));
  return result.length ? result.join(separator) : "—";
}

function count(value) {
  return Number.isFinite(value) ? String(value) : "—";
}

function booleanValue(value) {
  return typeof value === "boolean" ? String(value) : "—";
}

function withArticle(value) {
  return `${/^[aeiou]/i.test(value) ? "an" : "a"} ${value}`;
}

function toKebabCase(value) {
  return value.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

function parseNumber(value, percentageScale = 1) {
  const token = String(value ?? "").trim();
  const number = Number.parseFloat(token);
  if (!Number.isFinite(number)) return null;
  return token.endsWith("%") ? (number / 100) * percentageScale : number;
}

function parseAlpha(value) {
  const alpha = parseNumber(value, 1);
  return alpha === null ? 1 : Math.min(1, Math.max(0, alpha));
}

function srgbChannel(linear) {
  const gamma = linear <= 0.0031308 ? 12.92 * linear : 1.055 * linear ** (1 / 2.4) - 0.055;
  return Math.round(Math.min(1, Math.max(0, gamma)) * 255);
}

function oklabToRgba(lightness, a, b, alpha) {
  const lPrime = lightness + 0.3963377774 * a + 0.2158037573 * b;
  const mPrime = lightness - 0.1055613458 * a - 0.0638541728 * b;
  const sPrime = lightness - 0.0894841775 * a - 1.291485548 * b;
  const l = lPrime ** 3;
  const m = mPrime ** 3;
  const s = sPrime ** 3;

  return {
    r: srgbChannel(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    g: srgbChannel(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    b: srgbChannel(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
    a: alpha,
  };
}

function parseHue(value) {
  const token = String(value ?? "0").trim().toLowerCase();
  const amount = Number.parseFloat(token);
  if (!Number.isFinite(amount)) return null;
  if (token.endsWith("turn")) return amount * 360;
  if (token.endsWith("rad")) return (amount * 180) / Math.PI;
  if (token.endsWith("grad")) return amount * 0.9;
  return amount;
}

function parseColor(value) {
  const color = String(value ?? "").trim().toLowerCase();
  if (!color) return null;
  if (color === "transparent") return { r: 0, g: 0, b: 0, a: 0 };

  const hex = color.match(/^#([\da-f]{3,8})$/i)?.[1];
  if (hex) {
    const expanded = hex.length <= 4 ? [...hex].map((character) => character.repeat(2)).join("") : hex;
    if (![6, 8].includes(expanded.length)) return null;
    return {
      r: Number.parseInt(expanded.slice(0, 2), 16),
      g: Number.parseInt(expanded.slice(2, 4), 16),
      b: Number.parseInt(expanded.slice(4, 6), 16),
      a: expanded.length === 8 ? Number.parseInt(expanded.slice(6, 8), 16) / 255 : 1,
    };
  }

  const rgb = color.match(/^rgba?\((.*)\)$/s)?.[1];
  if (rgb !== undefined) {
    const slashParts = rgb.split("/");
    const components = slashParts[0].replaceAll(",", " ").trim().split(/\s+/).filter(Boolean);
    const alphaToken = slashParts[1] ?? (components.length > 3 ? components.pop() : undefined);
    if (components.length !== 3) return null;
    const channels = components.map((component) => parseNumber(component, 255));
    if (channels.some((channel) => channel === null)) return null;
    return {
      r: Math.round(Math.min(255, Math.max(0, channels[0]))),
      g: Math.round(Math.min(255, Math.max(0, channels[1]))),
      b: Math.round(Math.min(255, Math.max(0, channels[2]))),
      a: parseAlpha(alphaToken),
    };
  }

  const labMatch = color.match(/^(oklab|oklch)\((.*)\)$/s);
  if (labMatch) {
    const [componentsText, alphaText] = labMatch[2].split("/");
    const components = componentsText.trim().split(/\s+/).filter(Boolean);
    if (components.length !== 3) return null;
    const lightness = parseNumber(components[0], 1);
    if (lightness === null) return null;

    let a;
    let b;
    if (labMatch[1] === "oklch") {
      const chroma = parseNumber(components[1], 0.4);
      const hue = parseHue(components[2]);
      if (chroma === null || hue === null) return null;
      const radians = (hue * Math.PI) / 180;
      a = chroma * Math.cos(radians);
      b = chroma * Math.sin(radians);
    } else {
      a = parseNumber(components[1], 0.4);
      b = parseNumber(components[2], 0.4);
      if (a === null || b === null) return null;
    }
    return oklabToRgba(lightness, a, b, parseAlpha(alphaText));
  }

  return null;
}

function colorToHex(value) {
  const parsed = parseColor(value);
  if (!parsed) return null;
  const channel = (number) => Math.round(number).toString(16).padStart(2, "0").toUpperCase();
  const alpha = channel(parsed.a * 255);
  return `#${channel(parsed.r)}${channel(parsed.g)}${channel(parsed.b)}${alpha === "FF" ? "" : alpha}`;
}

function relativeLuminance(color) {
  const linear = (channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(color.r) + 0.7152 * linear(color.g) + 0.0722 * linear(color.b);
}

function paletteClassification(capture) {
  const buckets = { dark: 0, middle: 0, light: 0 };
  for (const entry of array(capture.colors?.items)) {
    const backgroundCount = array(entry.roles).find((role) => role.role === "background")?.count ?? 0;
    const color = parseColor(entry.color);
    if (!color || color.a <= 0.05 || backgroundCount <= 0) continue;
    const luminance = relativeLuminance(color);
    const bucket = luminance < 0.35 ? "dark" : luminance > 0.65 ? "light" : "middle";
    buckets[bucket] += backgroundCount;
  }

  if (buckets.dark + buckets.middle + buckets.light === 0) {
    for (const background of array(capture.backgrounds?.sections)) {
      const color = parseColor(background.backgroundColor);
      if (!color || color.a <= 0.05) continue;
      const luminance = relativeLuminance(color);
      buckets[luminance < 0.35 ? "dark" : luminance > 0.65 ? "light" : "middle"] += 1;
    }
  }

  const total = buckets.dark + buckets.middle + buckets.light;
  if (!total) return { label: "unclassified theme", detail: "no opaque background colors were captured" };
  const ratios = Object.fromEntries(
    Object.entries(buckets).map(([key, value]) => [key, Math.round((value / total) * 100)]),
  );
  const label = ratios.dark >= 60 ? "dark theme" : ratios.light >= 60 ? "light theme" : "mixed theme";
  return {
    label,
    detail: `${ratios.dark}% dark, ${ratios.middle}% mid-tone, and ${ratios.light}% light computed background occurrences`,
  };
}

function fontClassification(family) {
  const normalized = String(family ?? "").toLowerCase();
  if (normalized.includes("monospace")) return "monospace";
  if (normalized.includes("sans-serif")) return "sans-serif";
  if (/(^|[,\s])serif([,\s]|$)/.test(normalized)) return "serif";
  return "unclassified";
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function layoutClassification(capture) {
  const viewportWidth = capture.meta?.viewport?.width;
  if (!Number.isFinite(viewportWidth) || viewportWidth <= 0) {
    return { label: "unclassified layout", detail: "viewport width was not captured" };
  }
  const widths = array(capture.sections?.items)
    .map((section) => section.approximateWidth)
    .filter((width) => Number.isFinite(width) && width > 0);
  const medianWidth = median(widths);
  if (medianWidth === null) return { label: "unclassified layout", detail: "section widths were not captured" };
  const ratio = medianWidth / viewportWidth;
  const label = ratio >= 0.9 ? "full-width layout" : ratio <= 0.75 ? "contained layout" : "mixed-width layout";
  return { label, detail: `median section width ${Math.round(ratio * 100)}% of the viewport` };
}

function renderThemeSummary(capture) {
  const palette = paletteClassification(capture);
  const dominantColors = unique(
    array(capture.colors?.items)
      .map((entry) => ({ hex: colorToHex(entry.color), alpha: parseColor(entry.color)?.a ?? 0 }))
      .filter((entry) => entry.hex && entry.alpha > 0.05)
      .map((entry) => entry.hex),
  ).slice(0, 3);
  const fonts = array(capture.typography?.families);
  const primaryFont = fonts[0]?.family;
  const typography = fontClassification(primaryFont);
  const layout = layoutClassification(capture);
  const sectionCount = array(capture.sections?.items).length;
  const paletteText = dominantColors.length ? dominantColors.join(", ") : "no parseable colors";
  const fontText = primaryFont ? `, led by ${primaryFont}` : "";

  const typographyText = primaryFont
    ? `Typography uses a primarily ${typography} stack${fontText}`
    : "Typography could not be classified because no font family was captured";
  return `The capture maps to ${withArticle(palette.label)} (${palette.detail}), with a dominant usage palette of ${paletteText}. ${typographyText}. The captured outline contains ${sectionCount} section${sectionCount === 1 ? "" : "s"} and maps to ${withArticle(layout.label)} (${layout.detail}).`;
}

function formatRoles(roles) {
  return array(roles).map((role) => `${role.role} (${count(role.count)})`).join(", ") || "—";
}

function formatProperties(properties) {
  return array(properties).map((property) => `${property.property} (${count(property.count)})`).join(", ") || "—";
}

function formatSelectors(selectors) {
  return unique(array(selectors)).join("; ") || "—";
}

function renderHeader(capture) {
  const meta = capture.meta ?? {};
  const viewport = meta.viewport;
  const document = meta.document;
  const navigation = meta.navigation;
  const lines = [
    "# DESIGN.md",
    "",
    `- **Site title:** ${present(meta.title) ? markdownText(meta.title) : "Not captured"}`,
    `- **Final URL:** ${present(meta.url) ? htmlCode(meta.url) : "Not captured"}`,
    `- **Requested URL:** ${present(meta.requestedUrl) ? htmlCode(meta.requestedUrl) : "Not captured"}`,
    `- **Capture date:** ${present(meta.timestamp) ? htmlCode(meta.timestamp) : "Not captured"}`,
    `- **Schema version:** ${present(capture.schemaVersion) ? htmlCode(capture.schemaVersion) : "Not captured"}`,
  ];

  if (viewport) {
    lines.push(
      `- **Viewport:** ${count(viewport.width)} × ${count(viewport.height)} CSS pixels at device scale factor ${count(viewport.deviceScaleFactor)}`,
    );
  } else {
    lines.push("- **Viewport:** Not captured");
  }

  if (document) {
    lines.push(
      `- **Document:** ${count(document.scrollWidth)} × ${count(document.scrollHeight)} CSS pixels; language ${present(document.language) ? htmlCode(document.language) : "not captured"}; content type ${present(document.contentType) ? htmlCode(document.contentType) : "not captured"}`,
    );
  } else {
    lines.push("- **Document:** Not captured");
  }

  if (navigation) {
    lines.push(
      `- **Navigation:** status ${present(navigation.status) ? markdownText(navigation.status) : "not captured"}${present(navigation.statusText) ? ` (${markdownText(navigation.statusText)})` : ""}`,
    );
  } else {
    lines.push("- **Navigation:** Not captured");
  }

  lines.push("", renderThemeSummary(capture));
  return lines.join("\n");
}

function renderColors(capture) {
  const colors = array(capture.colors?.items);
  const lines = ["### Colors", ""];
  if (!colors.length) {
    lines.push("No colors were captured.");
    return lines.join("\n");
  }
  lines.push(
    `Computed from ${count(capture.colors?.inspectedElementCount)} inspected elements. Counts are computed-style occurrences, not pixel-area measurements.`,
    "",
    markdownTable(
      ["Hex", "Computed color", "Role hints", "Usage frequency", "Property evidence", "Example selectors"],
      colors.map((entry) => [
        colorToHex(entry.color) ?? "Unconvertible",
        entry.color,
        formatRoles(entry.roles),
        count(entry.count),
        formatProperties(entry.properties),
        formatSelectors(entry.exampleSelectors),
      ]),
    ),
  );
  return lines.join("\n");
}

function renderTypography(capture) {
  const families = array(capture.typography?.families);
  const lines = ["### Typography", ""];
  if (!families.length) {
    lines.push("No typography families were captured.");
    return lines.join("\n");
  }

  families.forEach((family, index) => {
    if (index) lines.push("");
    lines.push(
      `#### Font family ${index + 1}`,
      "",
      `**Computed stack:** ${htmlCode(family.family)}  `,
      `**Usage frequency:** ${count(family.count)}`,
      "",
    );
    const variants = array(family.variants);
    if (!variants.length) {
      lines.push("No variants were captured for this family.");
    } else {
      lines.push(
        markdownTable(
          ["Size", "Weight", "Line height", "Letter spacing", "Style", "Usage frequency", "Example element", "Sample text"],
          variants.map((variant) => [
            variant.size,
            variant.weight,
            variant.lineHeight,
            variant.letterSpacing,
            variant.fontStyle,
            count(variant.count),
            variant.exampleElement,
            variant.sampleText,
          ]),
        ),
      );
    }
  });
  return lines.join("\n");
}

function renderRankedValues(title, items, emptyMessage) {
  const lines = [`#### ${title}`, ""];
  if (!items.length) {
    lines.push(emptyMessage);
  } else {
    lines.push(
      markdownTable(
        ["Value", "Usage frequency", "Example selectors"],
        items.map((item) => [item.value, count(item.count), formatSelectors(item.exampleSelectors)]),
      ),
    );
  }
  return lines.join("\n");
}

function formatMediaWidths(widths) {
  return (
    array(widths)
      .map((width) => {
        const approximate = Number.isFinite(width.approximatePixels) ? ` ≈ ${width.approximatePixels}px` : "";
        return `${width.kind} ${width.value}${width.unit}${approximate}`;
      })
      .join("; ") || "—"
  );
}

function renderBreakpoints(capture) {
  const breakpoints = capture.breakpoints ?? {};
  const summaries = array(breakpoints.summary);
  const occurrences = array(breakpoints.items);
  const stylesheets = array(breakpoints.stylesheets);
  const lines = ["### Breakpoints", "", "#### Summary", ""];

  if (!summaries.length) {
    lines.push("No media-query breakpoints were captured.");
  } else {
    lines.push(
      markdownTable(
        ["Condition", "Occurrences", "Widths", "Sources"],
        summaries.map((summary) => [
          summary.condition,
          count(summary.count),
          formatMediaWidths(summary.widths),
          joinValues(summary.sources, "; "),
        ]),
      ),
    );
  }

  lines.push("", "#### Media-query occurrences", "");
  if (!occurrences.length) {
    lines.push("No media-query rule bodies were captured.");
  } else {
    occurrences.forEach((item, index) => {
      if (index) lines.push("");
      lines.push(
        `##### Media query ${index + 1}: ${markdownText(item.condition ?? "condition not captured")}`,
        "",
        `- **Source:** ${present(item.source) ? htmlCode(item.source) : "Not captured"}`,
        `- **Widths:** ${markdownText(formatMediaWidths(item.widths))}`,
        "",
        present(item.cssText) ? fenced(item.cssText, "css") : "The media-query CSS text was not captured.",
      );
    });
  }

  lines.push("", "#### Stylesheet coverage", "");
  if (!stylesheets.length) {
    lines.push("No stylesheet records were captured.");
  } else {
    lines.push(
      markdownTable(
        ["Source", "Origin", "Cross-origin", "Status", "Method", "Status code", "Bytes", "Error"],
        stylesheets.map((sheet) => [
          sheet.source,
          sheet.origin,
          booleanValue(sheet.crossOrigin),
          sheet.status,
          sheet.method,
          count(sheet.statusCode),
          count(sheet.bytes),
          sheet.error,
        ]),
      ),
    );
  }
  return lines.join("\n");
}

function renderSpacing(capture) {
  const spacing = capture.spacing ?? {};
  const common = array(spacing.commonValues);
  const lines = ["### Spacing scale", ""];
  if (!common.length) {
    lines.push("No common spacing values were captured.");
  } else {
    lines.push(
      markdownTable(
        ["Value", "Total frequency", "Margin frequency", "Padding frequency", "Example selectors"],
        common.map((item) => [
          item.value,
          count(item.count),
          count(item.marginCount),
          count(item.paddingCount),
          formatSelectors(item.exampleSelectors),
        ]),
      ),
    );
  }

  lines.push(
    "",
    renderRankedValues("Margin values", array(spacing.margins), "No margin values were captured."),
    "",
    renderRankedValues("Padding values", array(spacing.paddings), "No padding values were captured."),
    "",
    renderRankedValues("Container widths", array(spacing.containerMaxWidths), "No finite container max-widths were captured."),
    "",
    renderRankedValues("Border radii", array(spacing.borderRadii), "No non-zero border radii were captured."),
    "",
    renderRankedValues("Box shadows", array(spacing.boxShadows), "No box shadows were captured."),
  );
  return lines.join("\n");
}

function renderDesignTokens(capture) {
  return [
    "## Design tokens",
    "",
    renderColors(capture),
    "",
    renderTypography(capture),
    "",
    renderSpacing(capture),
    "",
    renderBreakpoints(capture),
  ].join("\n");
}

function renderSectionStyles(selector, styles) {
  const declarations = SECTION_STYLE_PROPERTIES
    .filter((property) => present(styles?.[property]))
    .map((property) => `  ${toKebabCase(property)}: ${styles[property]};`);
  if (!declarations.length) return null;
  return `${selector || ":scope"} {\n${declarations.join("\n")}\n}`;
}

function renderLayout(capture) {
  const sections = array(capture.sections?.items);
  const lines = ["## Layout system", ""];
  if (!sections.length) {
    lines.push("No layout sections were captured.");
    return lines.join("\n");
  }

  lines.push(
    `${sections.length} sections were emitted from ${count(capture.sections?.totalCandidates)} outline candidates, in document order.`,
  );
  sections.forEach((section, index) => {
    const structure = section.structure ?? {};
    const styles = renderSectionStyles(section.selector, section.keyComputedStyles);
    lines.push(
      "",
      `### ${index + 1}. ${markdownText(section.kind ?? section.tag ?? "section")}: ${htmlCode(section.selector ?? "selector not captured")}`,
      "",
      present(section.description) ? markdownText(section.description) : "No structural description was captured.",
      "",
      `- **Element:** ${htmlCode(section.tag ?? "not captured")}; id ${present(section.id) ? htmlCode(section.id) : "none"}; role ${present(section.role) ? htmlCode(section.role) : "none"}`,
      `- **Classes:** ${array(section.classes).length ? array(section.classes).map(htmlCode).join(", ") : "none"}`,
      `- **Position and size:** top ${count(section.documentTop)}px; ${count(section.approximateWidth)} × ${count(section.approximateHeight)}px`,
      `- **Headings:** ${array(section.headings).length ? array(section.headings).map((heading) => `“${markdownText(heading)}”`).join("; ") : "none"}`,
      `- **Structure:** ${count(structure.directChildren)} direct children; ${count(structure.headings)} headings; ${count(structure.links)} links; ${count(structure.buttons)} buttons; ${count(structure.images)} images`,
      "",
      styles ? fenced(styles, "css") : "No key computed styles were captured for this section.",
    );
  });
  return lines.join("\n");
}

function extractAnimatedProperties(cssText) {
  const properties = [];
  for (const match of String(cssText ?? "").matchAll(/[;{]\s*([\w-]+)\s*:/g)) {
    if (!properties.includes(match[1])) properties.push(match[1]);
  }
  return properties;
}

const ANIMATION_USE_FIELDS = [
  "name",
  "selector",
  "duration",
  "delay",
  "easing",
  "iterationCount",
  "direction",
  "fillMode",
  "playState",
  "animationTimeline",
  "intersectionObserved",
];

function deduplicateRecords(records, fields) {
  const grouped = new Map();
  for (const record of records) {
    const key = JSON.stringify(fields.map((field) => record?.[field]));
    const existing = grouped.get(key);
    if (existing) existing.occurrences += 1;
    else grouped.set(key, { record, occurrences: 1 });
  }
  return [...grouped.values()];
}

function animationDescription(keyframe) {
  const uses = array(keyframe.uses);
  const properties = extractAnimatedProperties(keyframe.cssText);
  const durations = unique(uses.map((use) => use.duration));
  const easing = unique(uses.map((use) => use.easing));
  const triggers = unique(keyframe.likelyTriggers);
  const selectorCount = unique([
    ...uses.map((use) => use.selector),
    ...array(keyframe.ruleUsages).map((usage) => usage.selector),
  ]).length;
  const propertyText = properties.length ? properties.join(", ") : "no declaration properties could be parsed";
  const timingText = uses.length
    ? `Observed durations are ${durations.length ? durations.join(", ") : "not captured"}, with easing ${easing.length ? easing.join(", ") : "not captured"}.`
    : "No active computed use supplied duration or easing data.";
  const triggerText = triggers.length
    ? `Likely triggers are ${triggers.join(", ")}, based on the capture evidence below.`
    : "No likely trigger was inferred.";
  const usageText = selectorCount
    ? `It is associated with ${selectorCount} unique selector${selectorCount === 1 ? "" : "s"}, listed below.`
    : "No using element or state rule was observed.";
  return `This keyframe animates ${propertyText}. ${timingText} ${triggerText} ${usageText}`;
}

function renderAnimationUses(uses) {
  const deduplicated = deduplicateRecords(array(uses), ANIMATION_USE_FIELDS);
  return markdownTable(
    [
      "Selector",
      "Duration",
      "Delay",
      "Easing",
      "Iterations",
      "Direction",
      "Fill mode",
      "Play state",
      "Timeline",
      "Intersection observed",
      "Occurrences",
    ],
    deduplicated.map(({ record, occurrences }) => [
      record.selector,
      record.duration,
      record.delay,
      record.easing,
      record.iterationCount,
      record.direction,
      record.fillMode,
      record.playState,
      record.animationTimeline,
      booleanValue(record.intersectionObserved),
      count(occurrences),
    ]),
  );
}

function renderKeyframe(keyframe, index) {
  const uses = array(keyframe.uses);
  const ruleUsages = array(keyframe.ruleUsages);
  const evidence = array(keyframe.triggerEvidence);
  const lines = [
    `### ${index + 1}. ${htmlCode(keyframe.name ?? "unnamed keyframe")}`,
    "",
    `- **Source:** ${present(keyframe.source) ? htmlCode(keyframe.source) : "Not captured"}`,
    `- **Vendor prefix:** ${present(keyframe.vendorPrefix) ? htmlCode(keyframe.vendorPrefix) : "none"}`,
    "",
    present(keyframe.cssText) ? fenced(keyframe.cssText, "css") : "The keyframe CSS text was not captured.",
    "",
    markdownText(animationDescription(keyframe)),
    "",
    "#### Observed uses",
    "",
  ];

  lines.push(uses.length ? renderAnimationUses(uses) : "No active computed uses were captured.");
  lines.push("", "#### Rule-based uses", "");
  if (!ruleUsages.length) {
    lines.push("No matching state or timeline rules were captured.");
  } else {
    lines.push(
      markdownTable(
        ["Selector", "Source", "Triggers"],
        ruleUsages.map((usage) => [usage.selector, usage.source, joinValues(usage.triggers)]),
      ),
    );
  }

  lines.push("", "#### Trigger evidence", "");
  if (!evidence.length) {
    lines.push("No trigger evidence was captured.");
  } else {
    evidence.forEach((item) => {
      lines.push(`- **${markdownText(item.type ?? "unknown")}:** ${markdownText(item.evidence ?? "No evidence text")} (${present(item.source) ? htmlCode(item.source) : "source not captured"})`);
    });
  }
  return lines.join("\n");
}

function renderTransitions(transitions) {
  const fields = ["selector", "properties", "durations", "easing", "delays"];
  const deduplicated = deduplicateRecords(array(transitions), fields);
  if (!deduplicated.length) return "No non-zero transitions were captured.";
  return markdownTable(
    ["Selector", "Properties", "Duration", "Easing", "Delay", "Occurrences"],
    deduplicated.map(({ record, occurrences }) => [
      record.selector,
      joinValues(record.properties),
      joinValues(record.durations),
      joinValues(record.easing),
      joinValues(record.delays),
      count(occurrences),
    ]),
  );
}

function renderAnimations(capture) {
  const animations = capture.animations ?? {};
  const keyframes = array(animations.keyframes);
  const unmatched = array(animations.unmatchedAnimationUses);
  const observerHints = array(animations.intersectionObserverHints);
  const lines = ["## Animations", "", "### Keyframes", ""];

  if (!keyframes.length) {
    lines.push("No keyframes were captured.");
  } else {
    keyframes.forEach((keyframe, index) => {
      if (index) lines.push("", "---", "");
      lines.push(renderKeyframe(keyframe, index));
    });
  }

  lines.push("", "### Transitions", "", renderTransitions(animations.transitions));
  lines.push("", "### Unmatched animation uses", "");
  lines.push(unmatched.length ? renderAnimationUses(unmatched) : "Every observed computed animation name was matched to a captured keyframe.");

  lines.push("", "### IntersectionObserver hints", "");
  if (!observerHints.length) {
    lines.push("No IntersectionObserver target hints were captured.");
  } else {
    const grouped = new Map();
    observerHints.forEach((selector) => grouped.set(selector, (grouped.get(selector) ?? 0) + 1));
    lines.push(
      markdownTable(
        ["Selector", "Occurrences"],
        [...grouped].map(([selector, occurrences]) => [selector, count(occurrences)]),
      ),
    );
  }

  return lines.join("\n");
}

function renderSectionBackgrounds(backgrounds) {
  if (!backgrounds.length) return "No section backgrounds were captured.";
  return markdownTable(
    [
      "Section selector",
      "Kind",
      "Color",
      "Background image",
      "Size",
      "Position",
      "Repeat",
      "Attachment",
      "Origin",
      "Clip",
    ],
    backgrounds.map((background) => [
      background.sectionSelector,
      background.sectionKind,
      background.backgroundColor,
      background.backgroundImage,
      background.backgroundSize,
      background.backgroundPosition,
      background.backgroundRepeat,
      background.backgroundAttachment,
      background.backgroundOrigin,
      background.backgroundClip,
    ]),
  );
}

function renderGradients(backgrounds) {
  const gradients = backgrounds.filter((background) => /(?:repeating-)?(?:linear|radial|conic)-gradient\(/i.test(background.backgroundImage ?? ""));
  if (!gradients.length) return "No gradients were captured.";
  const lines = [];
  gradients.forEach((background, index) => {
    if (index) lines.push("");
    lines.push(
      `#### Gradient ${index + 1}: ${htmlCode(background.sectionSelector ?? "selector not captured")}`,
      "",
      fenced(background.backgroundImage, "css"),
    );
  });
  return lines.join("\n");
}

function renderBackgroundImages(backgrounds) {
  const images = backgrounds.filter((background) => array(background.imageUrls).length);
  if (!images.length) return "No URL-backed section background images were captured.";
  return markdownTable(
    ["Section selector", "Computed background image", "Image URLs"],
    images.map((background) => [
      background.sectionSelector,
      background.backgroundImage,
      joinValues(background.imageUrls, "; "),
    ]),
  );
}

function renderEffects(backgrounds) {
  if (!backgrounds.length) return "No blend-mode or filter records were captured.";
  return markdownTable(
    ["Section selector", "Background blend", "Mix blend", "Filter", "Backdrop filter"],
    backgrounds.map((background) => [
      background.sectionSelector,
      background.backgroundBlendMode,
      background.mixBlendMode,
      background.filter,
      background.backdropFilter,
    ]),
  );
}

function renderHeroMedia(items) {
  if (!items.length) return "No video or canvas hero media were captured.";
  return markdownTable(
    ["Type", "Selector", "Section", "Displayed size", "Source or bitmap", "Playback or contexts"],
    items.map((item) => {
      const source = item.type === "video"
        ? `sources: ${joinValues(item.sourceUrls, "; ")}; poster: ${item.poster ?? "none"}`
        : `bitmap: ${count(item.bitmapWidth)} × ${count(item.bitmapHeight)}`;
      const configuration = item.type === "video"
        ? `autoplay=${booleanValue(item.autoplay)}, muted=${booleanValue(item.muted)}, loop=${booleanValue(item.loop)}, playsInline=${booleanValue(item.playsInline)}`
        : `contexts: ${joinValues(item.observedContextTypes)}`;
      return [
        item.type,
        item.selector,
        item.sectionSelector,
        `${count(item.approximateWidth)} × ${count(item.approximateHeight)}`,
        source,
        configuration,
      ];
    }),
  );
}

function renderInlineSvgs(inlineSvgs) {
  const items = array(inlineSvgs?.items);
  const lines = ["### Inline SVGs", ""];
  if (!items.length) {
    lines.push("No inline SVGs were captured.");
    return lines.join("\n");
  }

  lines.push(
    `Markup is verbatim below when the serialized SVG was smaller than the ${count(inlineSvgs?.thresholdBytes)}-byte capture threshold. Larger SVGs are metadata-only summaries.`,
    "",
    markdownTable(
      ["#", "Kind", "Selector", "ID", "Classes", "Bytes", "Rendered size", "ViewBox", "Role", "Accessible name"],
      items.map((item, index) => [
        count(index + 1),
        item.kind,
        item.selector,
        item.id,
        joinValues(item.classes),
        count(item.byteSize),
        `${count(item.width)} × ${count(item.height)}`,
        item.viewBox,
        item.role,
        item.accessibleName,
      ]),
    ),
  );

  const verbatim = items.filter((item) => item.kind === "verbatim" && present(item.markup));
  lines.push("", "#### Verbatim SVG markup", "");
  if (!verbatim.length) {
    lines.push("No SVG markup fell below the verbatim capture threshold.");
  } else {
    verbatim.forEach((item, index) => {
      if (index) lines.push("");
      lines.push(
        `##### SVG ${items.indexOf(item) + 1}: ${htmlCode(item.selector ?? "selector not captured")}`,
        "",
        fenced(item.markup, "svg"),
      );
    });
  }
  return lines.join("\n");
}

function renderBackgrounds(capture) {
  const backgrounds = array(capture.backgrounds?.sections);
  const lines = [
    "## Backgrounds and effects",
    "",
    "### Section backgrounds",
    "",
    renderSectionBackgrounds(backgrounds),
    "",
    "### Gradients",
    "",
    renderGradients(backgrounds),
    "",
    "### Background image URLs",
    "",
    renderBackgroundImages(backgrounds),
    "",
    "### Blend modes and filters",
    "",
    renderEffects(backgrounds),
    "",
    "### Video and canvas heroes",
    "",
    renderHeroMedia(array(capture.backgrounds?.heroMedia)),
    "",
    renderInlineSvgs(capture.inlineSvgs),
  ];
  return lines.join("\n");
}

function renderReplicationChecklist(capture) {
  const families = array(capture.typography?.families).map((family) => family.family);
  const colors = array(capture.colors?.items);
  const spacing = capture.spacing ?? {};
  const sections = array(capture.sections?.items);
  const sectionKinds = sections.map((section, index) => `${index + 1}) ${section.kind ?? section.tag ?? "section"}`).join(", ");
  const keyframes = array(capture.animations?.keyframes);
  const keyframeNames = keyframes.map((keyframe) => keyframe.name ?? "unnamed");
  const triggers = unique(keyframes.flatMap((keyframe) => array(keyframe.likelyTriggers)));
  const backgrounds = array(capture.backgrounds?.sections);
  const media = array(capture.backgrounds?.heroMedia);
  const svgs = array(capture.inlineSvgs?.items);

  const steps = [
    families.length
      ? `Load or map the ${families.length} captured computed font stacks, in priority order: ${families.map(htmlCode).join(", ")}. Reproduce every size, weight, line-height, letter-spacing, and style variant from the typography tables.`
      : "Choose explicit fallback typography; no font family was captured.",
    `Define tokens for all ${colors.length} captured colors using the hex and role evidence above. Preserve alpha channels and use occurrence counts only for prioritization, not as pixel-area estimates.`,
    `Implement the spacing system from ${array(spacing.commonValues).length} common values, ${array(spacing.containerMaxWidths).length} container widths, ${array(spacing.borderRadii).length} radii, and ${array(spacing.boxShadows).length} shadows; then encode every captured breakpoint condition.`,
    sections.length
      ? `Build the ${sections.length} outline sections in the exact numbered order from the layout chapter: ${markdownText(sectionKinds)}. Match each section’s dimensions, structure counts, and computed-style block before adding minor content.`
      : "Establish a page outline manually; no sections were captured.",
    `Apply all ${backgrounds.length} section background records, then recreate ${media.length} captured video/canvas hero media and ${svgs.length} inline SVG records from the effects chapter.`,
    keyframes.length
      ? `Copy all ${keyframes.length} keyframe occurrences verbatim, including duplicate names from different sources: ${keyframeNames.map(htmlCode).join(", ")}. Apply the observed timing, iteration, direction, fill-mode, play-state, and timeline values to the listed selectors.`
      : "Do not add keyframe motion unless the rebuilt product requires it; no keyframes were captured.",
    `Wire the deduplicated transition rows to their selectors. ${triggers.length ? `Implement the captured likely trigger classes (${markdownText(triggers.join(", "))}) and validate each against its evidence and IntersectionObserver hints.` : "No animation triggers were inferred; validate motion behavior manually."}`,
    "Compare the rebuilt page at the captured viewport and device scale factor, then review every fidelity note below before declaring parity.",
  ];

  return ["## Replication checklist", "", ...steps.flatMap((step, index) => [`${index + 1}. ${step}`, ""]).slice(0, -1)].join("\n");
}

function collectNotesAndErrors(value, path = "capture", output = []) {
  if (!value || typeof value !== "object") return output;
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectNotesAndErrors(item, `${path}[${index}]`, output));
    return output;
  }

  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    if (key === "notes") {
      if (Array.isArray(child)) {
        child.forEach((note, index) => {
          if (present(note)) output.push({ path: `${childPath}[${index}]`, message: String(note) });
        });
      } else if (present(child)) {
        output.push({ path: childPath, message: String(child) });
      }
      continue;
    }
    if (key === "error" && present(child)) {
      output.push({ path: childPath, message: String(child) });
      continue;
    }
    collectNotesAndErrors(child, childPath, output);
  }
  return output;
}

function renderFidelityNotes(capture) {
  const findings = collectNotesAndErrors(capture);
  const lines = ["## Fidelity notes", ""];
  if (!findings.length) {
    lines.push("No notes or errors were recorded in the capture.");
  } else {
    findings.forEach((finding) => {
      lines.push(`- **${htmlCode(finding.path)}:** ${markdownText(finding.message)}`);
    });
  }
  return lines.join("\n");
}

/**
 * Render a schema 1.0.0 design capture as deterministic, agent-readable Markdown.
 *
 * @param {object} capture
 * @returns {string}
 */
export function renderDesignMd(capture) {
  if (!capture || typeof capture !== "object" || Array.isArray(capture)) {
    throw new TypeError("renderDesignMd requires a design capture object.");
  }
  if (present(capture.schemaVersion) && capture.schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
    throw new RangeError(
      `Unsupported design capture schema version: ${capture.schemaVersion}; expected ${SUPPORTED_SCHEMA_VERSION}.`,
    );
  }

  return [
    renderHeader(capture),
    renderDesignTokens(capture),
    renderLayout(capture),
    renderAnimations(capture),
    renderBackgrounds(capture),
    renderReplicationChecklist(capture),
    renderFidelityNotes(capture),
    "",
  ].join("\n\n");
}
