# 1. What is being built, in one sentence?

A plain-Node.js CLI extraction engine called `designdna` that renders a URL in headless Chromium with Playwright and produces a single structured JSON “design capture” describing the site’s visual design exhaustively enough for another program to generate a replication guide.

# 2. List every required behavior (numbered, one per line, verbatim quotes where possible).

1. Create `package.json` in the fresh Node.js project with Playwright as a dependency.
2. Run `npx playwright install chromium` so the tool works.
3. Create `src/extract.js` exporting `extractDesign(url) -> capture object`.
4. Create `bin/designdna.js` as a CLI invoked as `node bin/designdna.js <url> --json capture.json`.
5. Given a URL, render it in headless Chromium with Playwright.
6. Produce a single structured JSON file, the “design capture.”
7. Include `meta`: “url, title, viewport used, timestamp.”
8. Include `colors`: a “frequency ranked list of all colors from computed styles,” with “role hints (text, background, border, accent)” and example selectors for each color.
9. Include `typography`: “every font family in use,” each with a list of “(size, weight, lineHeight, letterSpacing, example element/selector, sample text).”
10. Include `spacing`: “common margin/padding values ranked, container max widths, border radii, box shadows.”
11. Include `breakpoints`: values “from all stylesheets' media queries.”
12. Include `animations`: “EVERY @keyframes rule found in all reachable stylesheets (verbatim CSS text).”
13. Include all transitions from computed styles with “selector, properties, duration, easing.”
14. Include which elements use each keyframe animation.
15. Note likely animation triggers—“load, hover via :hover rules, scroll via IntersectionObserver hints or animation-timeline”—where detectable.
16. Include `backgrounds` for major sections: “computed background (colors, gradients verbatim, image URLs), blend modes, filters, backdrop filters.”
17. Detect “video/canvas/WebGL hero elements.”
18. Include `inlineSvgs`: inline `<svg>` elements under 4KB verbatim.
19. Summarize larger inline SVGs with “id/class, size, role.”
20. Include `sections`: a top-level page outline covering “header, nav, hero, each major section, footer.”
21. For every outlined section, include “tag, classes, approximate height, key computed styles, and a one line structural description.”
22. Handle cross-origin stylesheets gracefully: “fetch their text when possible, skip with a note when not.”
23. Create `docs/capture-schema.md` documenting “the exact JSON shape you emit” so another developer can code against it.
24. Test against `https://www.shopify.com/editions/winter2026`.
25. Test against a simple site such as `https://example.com`.
26. Print a short report at the end stating the Shopify capture’s counts of colors, keyframes, and sections.
27. Ensure “a failed sub extraction must not crash the run”; record “an error note in that field instead.”

# 3. List every explicit constraint (style, tools, limits).

1. Use plain Node.js with ES modules.
2. Use Playwright and headless Chromium.
3. Use no TypeScript.
4. Use no framework beyond Playwright.
5. Inline SVGs under 4KB must be captured verbatim; larger SVGs must be summarized.
6. Every reachable `@keyframes` rule must be captured with verbatim CSS text.
7. Gradients must be captured verbatim.
8. The output must be a single structured JSON file.
9. Keep the extraction robust: a failed sub-extraction must not crash the run and must instead produce an error note in its field.
10. Commit nothing; leave the working code in the current directory.

# 4. List the edge cases that must be handled.

1. Cross-origin stylesheets: fetch their text when possible, and skip them with a note when fetching is not possible.
2. Individual sub-extraction failures: do not crash the run; record an error note in the affected field.
3. Inline SVG size differences: preserve those under 4KB verbatim and summarize larger ones.
4. Animation triggers that may not be directly declared: note load, `:hover`, IntersectionObserver-related scroll, or `animation-timeline` triggers where detectable.
5. Hero media that may be implemented as video, canvas, or WebGL elements.
6. Both a visually complex target (`https://www.shopify.com/editions/winter2026`) and a simple target (`https://example.com`).

# 5. What is explicitly out of scope?

1. TypeScript.
2. Frameworks beyond Playwright.
3. Committing the changes.

# 6. How will success be checked?

1. Run the tool against `https://www.shopify.com/editions/winter2026`.
2. Run the tool against a simple site such as `https://example.com`.
3. Confirm Chromium is installed through `npx playwright install chromium` so the tool works.
4. Produce the structured capture JSON through the specified CLI form: `node bin/designdna.js <url> --json capture.json`.
5. Print a short final report containing the Shopify capture’s counts of colors, keyframes, and sections.
6. Provide `docs/capture-schema.md` with the exact emitted JSON shape so another developer can code against it.
