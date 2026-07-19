import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { renderDesignMd } from "../src/report.js";

const fixture = {
  schemaVersion: "1.0.0",
  meta: {
    url: "https://fixture.test/final",
    requestedUrl: "https://fixture.test/",
    title: "Fixture | Design",
    viewport: { width: 1200, height: 800, deviceScaleFactor: 1 },
    timestamp: "2026-01-02T03:04:05.000Z",
    document: { language: "en", scrollWidth: 1200, scrollHeight: 2400, contentType: "text/html" },
    navigation: { status: 200, statusText: "OK" },
    notes: ["Meta note."],
  },
  colors: {
    inspectedElementCount: 2,
    items: [
      {
        color: "rgba(17, 34, 51, 0.5)",
        count: 7,
        roles: [{ role: "background", count: 7 }],
        properties: [{ property: "background-color", count: 7 }],
        exampleSelectors: ["main | article"],
      },
    ],
    notes: [],
  },
  typography: {
    families: [
      {
        family: "Fixture Sans, sans-serif",
        count: 3,
        variants: [
          {
            size: "16px",
            weight: "400",
            lineHeight: "24px",
            letterSpacing: "normal",
            fontStyle: "normal",
            count: 3,
            exampleElement: "main > p",
            sampleText: "A sample",
          },
        ],
      },
    ],
    notes: [],
  },
  spacing: {
    commonValues: [{ value: "16px", count: 4, marginCount: 2, paddingCount: 2, exampleSelectors: ["main"] }],
    margins: [{ value: "16px", count: 2, exampleSelectors: ["main"] }],
    paddings: [{ value: "16px", count: 2, exampleSelectors: ["main"] }],
    containerMaxWidths: [{ value: "72rem", count: 1, exampleSelectors: ["main"] }],
    borderRadii: [{ value: "8px", count: 1, exampleSelectors: ["button"] }],
    boxShadows: [{ value: "rgb(0 0 0 / 20%) 0px 2px 8px", count: 1, exampleSelectors: ["article"] }],
    notes: [],
  },
  breakpoints: {
    items: [
      {
        condition: "(min-width: 48rem)",
        widths: [{ kind: "min", value: 48, unit: "rem", approximatePixels: 768 }],
        source: "inline://fixture",
        cssText: "@media (min-width: 48rem) { main { max-width: 72rem; } }",
      },
    ],
    summary: [
      {
        condition: "(min-width: 48rem)",
        count: 1,
        widths: [{ kind: "min", value: 48, unit: "rem", approximatePixels: 768 }],
        sources: ["inline://fixture"],
      },
    ],
    stylesheets: [
      {
        source: "inline://fixture",
        origin: "document",
        crossOrigin: false,
        status: "parsed",
        method: "inline",
        statusCode: null,
        bytes: 58,
        error: null,
      },
      {
        source: "https://fixture.test/missing.css",
        origin: "document",
        crossOrigin: true,
        status: "failed",
        method: "fetch",
        statusCode: 500,
        bytes: null,
        error: "Stylesheet error.",
      },
    ],
    notes: [],
  },
  animations: {
    keyframes: [
      {
        name: "fixture-fade",
        vendorPrefix: null,
        source: "inline://fixture",
        cssText: "@keyframes fixture-fade { from { opacity: 0; } to { opacity: 1; } }",
        uses: [
          {
            name: "fixture-fade",
            selector: ".card",
            duration: "200ms",
            delay: "0s",
            easing: "ease-out",
            iterationCount: "1",
            direction: "normal",
            fillMode: "both",
            playState: "running",
            animationTimeline: "auto",
            intersectionObserved: false,
          },
        ],
        ruleUsages: [{ selector: ".card:hover", source: "inline://fixture", triggers: ["hover"] }],
        likelyTriggers: ["hover"],
        triggerEvidence: [
          { type: "hover", evidence: "CSS selector .card:hover", source: "inline://fixture" },
        ],
      },
    ],
    transitions: [
      { selector: ".card", properties: ["opacity"], durations: ["200ms"], easing: ["ease-out"], delays: ["0s"] },
      { selector: ".card", properties: ["opacity"], durations: ["200ms"], easing: ["ease-out"], delays: ["0s"] },
    ],
    unmatchedAnimationUses: [],
    intersectionObserverHints: [],
    notes: ["Animation note."],
  },
  backgrounds: {
    sections: [
      {
        sectionSelector: "main",
        sectionKind: "main",
        backgroundColor: "rgba(17, 34, 51, 0.5)",
        backgroundImage: "linear-gradient(90deg, red, blue), url(\"https://fixture.test/bg.png\")",
        imageUrls: ["https://fixture.test/bg.png"],
        backgroundSize: "cover",
        backgroundPosition: "50% 50%",
        backgroundRepeat: "no-repeat",
        backgroundAttachment: "scroll",
        backgroundOrigin: "padding-box",
        backgroundClip: "border-box",
        backgroundBlendMode: "multiply",
        mixBlendMode: "normal",
        filter: "blur(1px)",
        backdropFilter: "none",
      },
    ],
    heroMedia: [
      {
        type: "video",
        selector: "main > video",
        sectionSelector: "main",
        approximateWidth: 1200,
        approximateHeight: 675,
        sourceUrls: ["https://fixture.test/hero.mp4"],
        autoplay: true,
        muted: true,
        loop: true,
        playsInline: true,
        poster: null,
      },
    ],
    notes: [],
  },
  inlineSvgs: {
    thresholdBytes: 4096,
    items: [
      {
        kind: "verbatim",
        selector: "svg.logo",
        id: null,
        classes: ["logo"],
        byteSize: 67,
        width: 24,
        height: 24,
        viewBox: "0 0 24 24",
        role: "image",
        accessibleName: "Logo",
        markup: '<svg class="logo" viewBox="0 0 24 24"><path d="M0 0h24v24H0z"/></svg>',
      },
    ],
    notes: [],
  },
  sections: {
    totalCandidates: 1,
    items: [
      {
        kind: "main",
        selector: "main",
        tag: "main",
        id: null,
        classes: [],
        role: "main",
        approximateHeight: 1200,
        approximateWidth: 1200,
        documentTop: 0,
        headings: ["Fixture heading"],
        keyComputedStyles: {
          display: "grid",
          position: "static",
          color: "rgb(255, 255, 255)",
          backgroundColor: "rgba(17, 34, 51, 0.5)",
          backgroundImage: "none",
          fontFamily: "Fixture Sans, sans-serif",
          fontSize: "16px",
          margin: "0px",
          padding: "16px",
          maxWidth: "none",
          borderRadius: "0px",
          boxShadow: "none",
          overflow: "visible",
        },
        structure: { directChildren: 2, headings: 1, links: 0, buttons: 1, images: 0 },
        description: "main headed “Fixture heading”; 2 direct children; 1 button.",
      },
    ],
    notes: ["Section note."],
  },
  notes: ["Root note."],
};

async function loadCapture(path) {
  return JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));
}

test("renderDesignMd renders the fixture deterministically and without mutating it", () => {
  const before = JSON.stringify(fixture);
  const first = renderDesignMd(fixture);
  const second = renderDesignMd(fixture);

  assert.equal(first, second);
  assert.equal(JSON.stringify(fixture), before);
  assert.match(first, /^# DESIGN\.md/m);
  assert.match(first, /#11223380/);
  assert.ok(first.includes(fixture.animations.keyframes[0].cssText));
  assert.ok(first.includes(fixture.breakpoints.items[0].cssText));
  assert.ok(first.includes(fixture.inlineSvgs.items[0].markup));
  assert.match(first, /\.card[^\n]+opacity[^\n]+200ms[^\n]+ease-out[^\n]+2/);
  assert.match(first, /capture\.breakpoints\.stylesheets\[1\]\.error/);
  assert.match(first, /Stylesheet error\./);
  assert.match(first, /capture\.notes\[0\].*Root note\./);
});

test("renderDesignMd handles empty optional fields and rejects unsupported schemas", () => {
  const report = renderDesignMd({});
  assert.match(report, /No colors were captured\./);
  assert.match(report, /No layout sections were captured\./);
  assert.match(report, /No keyframes were captured\./);
  assert.match(report, /No notes or errors were recorded/);
  assert.throws(() => renderDesignMd({ schemaVersion: "2.0.0" }), /Unsupported design capture schema version/);
});

for (const filename of ["example.json", "shopify-winter2026.json"]) {
  test(`renderDesignMd renders ${filename} and includes every keyframe name`, async () => {
    const capture = await loadCapture(`../captures/${filename}`);
    const report = renderDesignMd(capture);

    assert.ok(report.length > 0);
    for (const keyframe of capture.animations.keyframes) {
      assert.ok(report.includes(keyframe.name), `missing keyframe name ${keyframe.name}`);
      assert.ok(report.includes(keyframe.cssText), `missing verbatim CSS for ${keyframe.name}`);
    }

    if (filename === "shopify-winter2026.json") {
      const demonstration = await readFile(new URL("../examples/DESIGN-shopify.md", import.meta.url), "utf8");
      assert.equal(demonstration, report, "Shopify demonstration artifact is stale");
    }
  });
}
