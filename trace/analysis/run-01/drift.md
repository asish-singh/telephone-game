# Drift classification, run-01

Neutral read of trace/snapshots/run-01/{S0,S1,S2-codex-1,S2-codex-2,S3}.md and trace/run-01.jsonl. This agent took no part in the build.

## Step 1, canonical requirements from S0 only

| id | name | S0 text |
|---|---|---|
| R1 | Platform open | "a web or desktop app (whatever is feasible)" (S0 L3, L14) |
| R2 | URL input | "Take a URL as input." (S0 L7) |
| R3 | Look at the live site, CSS and code | "look at the website in browswer or anyhow and its css and all code" (S0 L8) |
| R4 | Output file named design.md | "a exhaustive detailed design.md file" (S0 L9, L15) |
| R5 | Exhaustive, replicate-grade detail | "exhaustive" / "great detail" / "so that any ai agent can understand and replicate it" (S0 L10, L16) |
| R6 | Describe theme, colors, format | "describe the theme and colours and format in detail" (S0 L10) |
| R7 | Describe CSS animations and backgrounds | "also the css animation and backgrounds" (S0 L10) |
| R8 | Describe every inline-encoded element | "whatever elements the website encodes in line in great detail" (S0 L10) |
| R9 | Shopify winter2026 as example input | "https://www.shopify.com/editions/winter2026 is a example input from a user" (S0 L17) |

S0 explicitly leaves edge cases, out-of-scope items, and a success test unstated (S0 L21, L25, L29), so nothing there is canonical.

## Step 2, requirement table

| id | name | S1 (Claude decomposition) | S2 (Codex combined) | S3 (final/as-built) | Notes |
|---|---|---|---|---|---|
| R1 | Platform open | mutated | mutated | mutated | S1 narrows "web or desktop app, whatever feasible" straight to "A Node.js CLI tool" (S1 L3). S2-codex-1 (L3) and S2-codex-2 (L3) both inherit "CLI." S3 confirms "A Node.js CLI tool named designdna" (S3 L3) with a fixed, non-configurable viewport (S3 L41, L96). No layer ever revisits the platform choice or notes it as a narrowing; never restored. |
| R2 | URL input | preserved | preserved | preserved | S1 L4/10; S2-codex-1 L4/10; S3 L9-L13. S3 adds a protocol restriction to http/https (S3 L12, L16) as a refinement, not a scope change, since S0 never specified other protocols. |
| R3 | Look at site, CSS and code | preserved | preserved | preserved | Implemented as headless Chromium via Playwright reading computed styles and all reachable stylesheets (S1 L3, L5; S2-codex-1 L5, L18; S3 L9, L18, L24). |
| R4 | Output file design.md | mutated | mutated | mutated | S0 names the file "design.md" (lowercase, S0 L9,15). From S1 onward every layer renames it "DESIGN.md" (S1 L3,17,22; S2-codex-2 L3,7; S3 L3,9,15). The renaming is introduced at the S1 decomposition step and never reconsidered; a small but real and consistent literal drift from the original spec. |
| R5 | Exhaustive, replicate-grade detail | preserved | preserved | preserved | S1 L3 ("exhaustive, agent readable DESIGN.md"); S2-codex-2 L2,8,24-25 (replication checklist); S3 L3,25,31 (replication checklist, fidelity notes walking the whole capture). |
| R6 | Theme, colors, format | preserved | preserved | preserved | S1 L18-19 (theme summary, colors table, typography table); S2-codex-2 L7-11; S3 L19-23, L31 (design tokens chapter). Detail level increases at each layer but meaning is intact. |
| R7 | CSS animations and backgrounds | preserved | preserved | preserved | Elevated to "the flagship chapter" starting at S1 L21, kept in S2-codex-2 L14-23 and S3 L25-26, L31. This is a faithful, if much-expanded, carry-through of R7. |
| R8 | Inline-encoded elements | preserved | preserved | preserved | Realized as the `inlineSvgs` field (S1 L16, L18-19; S2-codex-1 L18-19; S3 L27). S0's broad "whatever elements the website encodes in line" is narrowed specifically to inline `<svg>` elements; arguably a scope narrowing, but it is the literal, most natural reading of "elements ... in line" and is applied consistently at every layer, so it is judged preserved rather than mutated. |
| R9 | Shopify winter2026 example | preserved | preserved | preserved | S1 L20 ("Test against https://www.shopify.com/editions/winter2026"); S2-codex-1 L24, L30; S3 L27 (`scripts/smoke.js` target), S3 L106-109 (acceptance/demo artifact `examples/DESIGN-shopify.md`). |

## Invented items per layer

Items present at a layer with no traceable S0 origin.

**S1 (Claude decomposition)**
- Two-agent split into an extraction engine (capture.json) and a separate report writer (DESIGN.md), with a named tool "designdna" (S1 L3).
- `example.com` added as a second, simple test target alongside the Shopify URL (S1 L20, L25).
- A published JSON schema contract, `docs/capture-schema.md` (S1 L19, L23).
- Language/tooling constraints: plain Node.js ES modules, no TypeScript, no framework beyond Playwright, no dependencies for the report writer, no AI calls in the report writer (S1 L40-46).
- A specific CLI surface: `--json capture.json` and `-o DESIGN.md`, combinable (S1 L8, L23).
- A unit-test obligation (`test/report.test.js`) and an `npm test` gate (S1 L27-28, L33-34).
- A generated demonstration artifact `examples/DESIGN-shopify.md` (S1 L29, L35).
- Process constraints on the coding agents: "commit nothing," "do not modify src/extract.js" (S1 L42-43).

**S2 (Codex, both sub-agents)**
- No requirement-bearing inventions beyond what S1 already specified; S2-codex-1 and S2-codex-2 restate S1's instruction faithfully at similar or greater fidelity. The only new content is exact wording, not new scope.

**S3 (final/as-built)**
- A concrete, versioned JSON contract, `schemaVersion: "1.0.0"`, with a hard `RangeError` for any other version (S3 L26, L32, L100).
- Fixed, non-configurable capture conditions: 1440x900 viewport, device scale factor 1, light color scheme, `en-US` locale, non-reduced motion (S3 L9, L41, L96).
- Numeric limits never specified upstream: `MAX_EXAMPLE_SELECTORS = 6`, `MAX_STYLESHEETS = 500`, `MAX_STYLESHEET_BYTES = 20 MiB`, navigation timeout 60s, network-idle timeout 10s, extra settle wait 1.5s, web-fonts-ready race 8s, stylesheet fetch timeout 30s, error-message truncation at 4000 characters, `maxSections = 50` (S3 L44-51).
- `scripts/smoke.js` as a standing live smoke test with its own exit-code contract (S3 L8, L33, L86, L108).
- Shadow-DOM traversal and a `host >>> inner` selector notation for open shadow roots (S3 L27, L80, L98).
- IntersectionObserver/canvas instrumentation injected before page scripts run, for scroll-trigger and hero-canvas detection (S3 L17).
- CLI argument-parsing edge behavior: rejecting unknown flags, `--help`/`-h`, and specific error strings (S3 L10, L87).

None of these S3 inventions contradict an S0 requirement; they are elaborations of the S1-invented spec (schema doc, tests, CLI flags) made concrete, except for the fixed capture conditions and numeric limits, which are genuinely new constraints with no antecedent at any earlier layer.

## Step 3, recovery linkage

| seq | requirement protected | what happened |
|---|---|---|
| 5-6 | R7 (animations), R6/R8 (structural/format detail) | seq 5: supervisor review found 0 keyframes captured despite 40 named animations in use, and a 220-item section list instead of a top-level outline. seq 6: correction instructs codex-1 to fix CSS parser resilience so all keyframes are captured, and make the section outline top level (8-25 entries). This restores R7 (animation capture had silently failed to zero) and protects the top-level readability that R6/R8 depend on for the layout/format description to be usable. |
| 8-9 | R9 (example.com as required test target), R5 (exhaustiveness across both test sites) | seq 8: review finds Shopify acceptance now passes (14 keyframes, 17 sections) but the example.com outline regressed to 0 of 1 sections. seq 9: correction requires the outline to fall back to best candidates instead of returning empty on simple pages. This protects the exhaustiveness bar (R5) from silently failing on the simpler of the two required test targets. |
| 14-15 | R6 (accurate theme/color description) | seq 14: E2E review finds the DESIGN.md is exhaustive and correct but the color evidence includes non-visual selectors (head, meta, title) leaking from the capture. seq 15: correction to codex-1 to exclude non-rendered elements (head, meta, title, script, style, link) from computed-style inspection. This protects R6's fidelity, since S0 asks for the theme and colors to be described accurately, not polluted with non-rendered markup. |

Every recovery in the trace is a review/correction pair issued by Claude back to codex-1; no requirement in the canonical S0 list was ever dropped outright at any layer, and every correction cycle ends in an explicit acceptance signal (seq 11, seq 17) before handoff (seq 18).

## Findings summary, in plain language

1. The one clear and lasting drift is the platform choice. Asish's original ask left the door open to a web or desktop app, whichever was easiest. Claude's very first decomposition step quietly picked a command line tool instead, and nothing downstream ever surfaced that as a choice worth confirming with Asish. It is a small technical decision, but it is also the one place a genuine option in the original ask was closed off without discussion.
2. The output file's name drifted from lowercase "design.md" to uppercase "DESIGN.md" at the same decomposition step, and stayed that way through to the finished tool. Harmless in practice, but it is a literal mismatch with what was asked for.
3. Every substantive requirement in the original ask (URL in, look at the live site and its CSS, produce an exhaustive theme and colour and animation and background description, use the Shopify page as the test case) survived intact all the way to the finished build. Nothing was dropped.
4. Most of what looks like "drift" is actually healthy elaboration: the original one paragraph ask never specified a JSON schema, a test suite, numeric limits, or a fixed browser viewport, and Claude and Codex had to invent all of that to make something buildable. That is expected and appropriate for turning a rough ask into working code, not a failure of intent transfer.
5. The trace shows the review loop working as intended: three separate correction cycles caught real regressions (animations silently returning zero, a simple test page's outline going empty, and non-visual HTML elements leaking into the colour report) before the supervisor accepted the work, so quality drift within the implementation was actively caught and fixed rather than shipped.
