# 1. What is being built, in one sentence?

A report writer for the `designdna` CLI that converts a design capture JSON into an exhaustive, agent-readable `DESIGN.md` and is wired into the existing extraction CLI flow.

# 2. List every required behavior (numbered, one per line, verbatim quotes where possible).

1. Create `src/report.js` exporting `renderDesignMd(capture) -> string`.
2. Produce “an exhaustive, agent readable DESIGN.md.”
3. Code strictly against `docs/capture-schema.md` and verify the implementation against `captures/example.json` and `captures/shopify-winter2026.json`.
4. Wire the report writer into `bin/designdna.js` so `node bin/designdna.js <url> -o DESIGN.md` runs extraction and then reporting.
5. Keep the existing `--json` flag working.
6. Allow `--json` and `-o DESIGN.md` to be combined.
7. Start `DESIGN.md` with a header, site title, URL, capture date, and one paragraph summarizing the theme from the captured data.
8. Derive the theme summary deterministically from the dominant palette, typographic character, and layout feel.
9. Include a Design tokens chapter with colors as a table containing hex, role hints, usage frequency, and example selectors.
10. Include typography as a table per font family.
11. Include the spacing scale, radii, shadows, container widths, and breakpoints.
12. Include a Layout system chapter with the section outline as a numbered walkthrough.
13. Give every layout walkthrough entry its structural description and key computed styles in a small CSS block.
14. Include an Animations chapter as “the flagship chapter.”
15. Include “EVERY keyframe verbatim in a css code block.”
16. Follow each keyframe with a plain-English description covering the animated properties, duration, easing, likely trigger, and the elements that use it.
17. Include a transitions table with selector, properties, duration, and easing.
18. Deduplicate transitions sensibly.
19. Include a Backgrounds and effects chapter.
20. Include gradients verbatim.
21. Include background images with URLs.
22. Include blend modes, filters, video/canvas heroes, and notable inline SVGs.
23. Put notable inline SVGs in `svg` code blocks.
24. Include a Replication checklist as a numbered list an AI agent can follow to rebuild the look.
25. Make the checklist cover loading fonts, defining tokens, building sections in order, adding keyframes, and wiring triggers.
26. Include Fidelity notes that surface every note and error recorded in the capture.
27. Preserve the required chapter order: header/theme summary; design tokens; layout system; animations; backgrounds and effects; replication checklist; fidelity notes.
28. Handle missing or empty fields gracefully by omitting affected sections with a one-line note instead of crashing.
29. Escape Markdown safely.
30. Add unit tests in `test/report.test.js` using a small fixture capture and both real captures.
31. Test that every capture renders without throwing.
32. Test that the report includes every keyframe name.
33. Run `npm test`.
34. Generate `examples/DESIGN-shopify.md` from `captures/shopify-winter2026.json` as a demonstration artifact.

# 3. List every explicit constraint (style, tools, limits).

1. Work in the existing Node.js project.
2. “Do not modify src/extract.js.”
3. The report renderer must be a deterministic pure function.
4. Use plain Node ES modules.
5. Use no dependencies.
6. Make no AI calls.
7. Do not invent adjectives in the theme summary beyond deterministic mechanical mappings, such as mapping a dark background ratio to “dark theme.”
8. Follow the documented capture schema exactly and verify against both named real captures.
9. Preserve the specified `DESIGN.md` chapter order.
10. Include every keyframe verbatim.
11. Write animation explanations in plain English.
12. Make the result exhaustive and agent-readable.
13. Escape Markdown safely.

# 4. List the edge cases that must be handled.

1. Missing capture fields must not cause a crash; omit the affected section and include a one-line note.
2. Empty capture fields must not cause a crash; omit the affected section and include a one-line note.
3. The `--json` flag must continue to work when used alone.
4. The `--json` and report-output flags may be used together.
5. Repeated transition records must be deduplicated sensibly.
6. Markdown-sensitive captured content must be escaped safely.
7. Every recorded capture note and error must appear in Fidelity notes so limitations are not hidden.
8. Every captured keyframe name must be present in the rendered report.

# 5. What is explicitly out of scope?

1. Modifying `src/extract.js`.
2. Using AI calls to create the theme summary or report content.
3. Adding dependencies.
4. Inventing non-mechanical descriptive adjectives for the theme summary.

# 6. How will success be checked?

1. The implementation will be checked against `docs/capture-schema.md` and verified with `captures/example.json` and `captures/shopify-winter2026.json`.
2. `test/report.test.js` will render a small fixture and both real captures and assert that rendering does not throw.
3. The tests will assert that every keyframe name is included in the output.
4. `npm test` must pass.
5. `examples/DESIGN-shopify.md` must be generated from `captures/shopify-winter2026.json` as the demonstration artifact.
6. The CLI behavior must support `node bin/designdna.js <url> -o DESIGN.md`, retain `--json`, and allow the two flags to be combined.
