import assert from "node:assert/strict";
import test from "node:test";
import { __internal, extractDesign } from "../src/extract.js";

test("CSS traversal preserves keyframes and discovers nested media/state/timeline rules", () => {
  const css = `
@import url("theme.css") screen;
@media (min-width: 48rem) and (max-width: 1200px) {
  .card:hover { animation: reveal 300ms ease; }
  @supports (animation-timeline: view()) {
    .reveal { animation: reveal 1s; animation-timeline: view(); }
  }
}
@-webkit-keyframes reveal { from { opacity: 0; } to { opacity: 1; } }
`;
  const parsed = __internal.parseCssText(css, "https://example.test/base.css");

  assert.equal(parsed.imports[0].rawUrl, "theme.css");
  assert.equal(parsed.mediaQueries.length, 1);
  assert.equal(parsed.stateRules[0].selector, ".card:hover");
  assert.equal(parsed.timelineRules[0].selector, ".reveal");
  assert.equal(parsed.keyframes[0].name, "reveal");
  assert.equal(parsed.keyframes[0].vendorPrefix, "-webkit-");
  assert.match(parsed.keyframes[0].cssText, /^@-webkit-keyframes reveal/);
  assert.match(parsed.keyframes[0].cssText, /to \{ opacity: 1; \} \}$/);
});

test("CSS traversal recovers verbatim keyframes from minified CSS with URL braces and a truncated block", () => {
  const keyframes = "@keyframes nav-item-in{0%{opacity:0;transform:translateY(-1rem)}to{opacity:1;transform:none}}";
  const css =
    '.content::before{content:"} @keyframes string-decoy{from{opacity:0}}"}' +
    "/* } @keyframes comment-decoy{from{opacity:0}} */" +
    ".icon{background:url(data:image/svg+xml,<svg>{not-a-css-block}</svg>)}" +
    ".truncated{color:red;" +
    keyframes;
  const parsed = __internal.parseCssText(css, "https://example.test/minified.css");

  assert.equal(parsed.keyframes.length, 1);
  assert.equal(parsed.keyframes[0].name, "nav-item-in");
  assert.equal(parsed.keyframes[0].cssText, keyframes);
  assert.ok(parsed.notes.some((note) => /unterminated CSS block/.test(note)));

  const animations = __internal.buildAnimations(
    [{ source: "https://example.test/minified.css", parsed }],
    { keyframes: [], stateRules: [], timelineRules: [] },
    {
      transitions: [],
      intersectionObservedSelectors: [],
      animationUsages: [{ name: "nav-item-in", selector: "nav > a", animationTimeline: "auto" }],
    },
  );
  assert.equal(animations.unmatchedAnimationUses.length, 0);
});

test("breakpoint width extraction handles legacy and range syntax", () => {
  assert.deepEqual(__internal.mediaWidths("(min-width: 48rem) and (width < 1200px)"), [
    { kind: "min", value: 48, unit: "rem", approximatePixels: 768 },
    { kind: "<", value: 1200, unit: "px", approximatePixels: 1200 },
  ]);
  assert.deepEqual(__internal.mediaWidths("(600px <= width)"), [
    { kind: "<=", value: 600, unit: "px", approximatePixels: 600 },
  ]);
});

test("animation aggregation associates computed uses and likely triggers", () => {
  const parsed = __internal.parseCssText(
    `
.thing:hover { animation: reveal .2s ease; }
.thing { animation: reveal 1s linear; animation-timeline: view(); }
@keyframes reveal { from { opacity: 0 } to { opacity: 1 } }
`,
    "inline://test",
  );
  const computed = {
    transitions: [],
    intersectionObservedSelectors: [".thing"],
    animationUsages: [
      {
        name: "reveal",
        selector: ".thing",
        animationTimeline: "view()",
        intersectionObserved: true,
      },
    ],
  };
  const result = __internal.buildAnimations(
    [{ source: "inline://test", parsed }],
    { keyframes: [], stateRules: [], timelineRules: [] },
    computed,
  );

  assert.equal(result.keyframes.length, 1);
  assert.deepEqual(result.keyframes[0].likelyTriggers.sort(), ["hover", "scroll"]);
  assert.equal(result.keyframes[0].uses[0].selector, ".thing");
  assert.equal(result.intersectionObserverHints[0], ".thing");
});

test("extractDesign rejects non-web protocols before browser launch", async () => {
  await assert.rejects(() => extractDesign("file:///tmp/page.html"), /only supports http/);
});

test("computed style collection skips non-rendered document elements but keeps display-none elements", () => {
  const originalGlobals = new Map(
    ["CSS", "Element", "Node", "ShadowRoot", "document", "getComputedStyle", "window"].map((name) => [
      name,
      Object.getOwnPropertyDescriptor(globalThis, name),
    ]),
  );
  const setGlobal = (name, value) => {
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  };

  class FakeElement {}
  class FakeShadowRoot {}
  let document;
  const element = (localName, options = {}) => {
    const value = new FakeElement();
    Object.assign(value, {
      id: "",
      localName,
      classList: [],
      closest: (selector) => (selector === "head" && options.insideHead ? { localName: "head" } : null),
      getRootNode: () => document,
      isConnected: true,
      nodeType: 1,
      parentElement: null,
      shadowRoot: null,
    });
    return value;
  };

  const hidden = element("div");
  const candidates = [
    element("head", { insideHead: true }),
    element("meta", { insideHead: true }),
    element("title", { insideHead: true }),
    element("script"),
    element("style"),
    element("link"),
    element("template"),
    element("title"),
    hidden,
  ];
  const colorProbe = element("span");
  colorProbe.setAttribute = () => {};
  colorProbe.style = {};
  colorProbe.remove = () => {};
  document = {
    body: { append: () => {} },
    createElement: () => colorProbe,
    querySelectorAll: (selector) => (selector === "*" ? candidates : []),
  };

  const hiddenStyle = {
    0: "color",
    length: 1,
    display: "none",
    visibility: "visible",
    color: "rgb(1, 2, 3)",
    transitionProperty: "none",
    transitionDuration: "0s",
    animationName: "none",
    getPropertyValue: (property) => (property === "color" ? "rgb(1, 2, 3)" : ""),
  };
  const pseudoStyle = { content: "none", display: "none" };
  const inspected = [];

  try {
    setGlobal("CSS", { escape: (value) => value, supports: () => true });
    setGlobal("Element", FakeElement);
    setGlobal("Node", { ELEMENT_NODE: 1 });
    setGlobal("ShadowRoot", FakeShadowRoot);
    setGlobal("document", document);
    setGlobal("window", { __designDnaIntersectionElements: [] });
    setGlobal("getComputedStyle", (target, pseudo) => {
      if (target === colorProbe) return { color: "rgb(1, 2, 3)" };
      inspected.push(target);
      return pseudo ? pseudoStyle : hiddenStyle;
    });

    const result = __internal.collectComputedDesign({ maxExamples: 6 });

    assert.equal(result.inspectedElementCount, 1);
    assert.deepEqual(new Set(inspected), new Set([hidden]));
    assert.equal(result.colors[0].color, "rgb(1, 2, 3)");
    assert.equal(result.colors[0].count, 1);
    assert.deepEqual(result.colors[0].exampleSelectors, ["div"]);
  } finally {
    for (const [name, descriptor] of originalGlobals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }
});

test("outline falls back to the single visible section on a minimal page", () => {
  const originalGlobals = new Map(
    ["CSS", "HTMLCanvasElement", "HTMLVideoElement", "Node", "document", "getComputedStyle", "innerHeight", "innerWidth", "scrollY", "window"].map(
      (name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)],
    ),
  );

  const setGlobal = (name, value) => {
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  };

  const html = { localName: "html", children: [], clientWidth: 1440 };
  const body = {
    id: "",
    localName: "body",
    tagName: "BODY",
    className: "",
    classList: [],
    children: [],
    parentElement: html,
    closest: () => null,
    matches: (selector) => selector.includes("body"),
  };
  const section = {
    id: "",
    localName: "div",
    tagName: "DIV",
    className: "page",
    classList: ["page"],
    children: [],
    parentElement: body,
    getAttribute: () => null,
    getBoundingClientRect: () => ({ top: 40, right: 1020, bottom: 240, left: 420, width: 600, height: 200 }),
    matches: () => false,
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  html.children = [body];
  body.children = [section];

  const computedStyle = {
    display: "block",
    visibility: "visible",
    position: "static",
    color: "rgb(0, 0, 0)",
    backgroundColor: "rgba(0, 0, 0, 0)",
    backgroundImage: "none",
    backgroundSize: "auto",
    backgroundPosition: "0% 0%",
    backgroundRepeat: "repeat",
    backgroundAttachment: "scroll",
    backgroundOrigin: "padding-box",
    backgroundClip: "border-box",
    backgroundBlendMode: "normal",
    mixBlendMode: "normal",
    filter: "none",
    fontFamily: "serif",
    fontSize: "16px",
    margin: "40px auto",
    padding: "0px",
    maxWidth: "none",
    borderRadius: "0px",
    boxShadow: "none",
    overflow: "visible",
    getPropertyValue: () => "none",
  };

  try {
    setGlobal("CSS", { escape: (value) => value });
    setGlobal("HTMLCanvasElement", class HTMLCanvasElement {});
    setGlobal("HTMLVideoElement", class HTMLVideoElement {});
    setGlobal("Node", { DOCUMENT_POSITION_FOLLOWING: 4, DOCUMENT_POSITION_PRECEDING: 2 });
    setGlobal("document", {
      documentElement: html,
      querySelectorAll: (selector) => (selector === "body > *, main > *" ? [section] : []),
    });
    setGlobal("getComputedStyle", () => computedStyle);
    setGlobal("innerHeight", 900);
    setGlobal("innerWidth", 1440);
    setGlobal("scrollY", 0);
    setGlobal("window", { __designDnaCanvasContexts: [] });

    const outline = __internal.collectPageOutline({ maxSections: 50 });

    assert.equal(outline.totalCandidates, 1);
    assert.equal(outline.sections.length, 1);
    assert.equal(outline.sections[0].selector, "body > div.page");
    assert.ok(outline.notes.some((note) => /kept the 1 largest visible candidate as a fallback/.test(note)));
  } finally {
    for (const [name, descriptor] of originalGlobals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }
});
