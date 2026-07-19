# Design capture schema

`designdna` emits UTF-8 JSON. The current schema version is `1.0.0`. Consumers must check
`schemaVersion` before decoding. New optional properties may be added within a schema version;
renames, removals, or type changes require a new version.

Every major extraction field has a `notes: string[]` member. A failed sub-extraction produces an
empty value plus a note instead of aborting the capture. Counts are integer occurrence counts.
Selectors are stable best-effort hints, not guaranteed to remain queryable after the page mutates.
Open-shadow-root selectors use `host-selector >>> inner-selector` notation.

## Root object

```text
DesignCapture {
  schemaVersion: "1.0.0"
  meta: Meta
  colors: Colors
  typography: Typography
  spacing: Spacing
  breakpoints: Breakpoints
  animations: Animations
  backgrounds: Backgrounds
  inlineSvgs: InlineSvgs
  sections: Sections
  notes: string[]
}
```

`notes` at the root contains capture-wide limitations or unexpected errors that do not belong to
one field.

## `meta`

```text
Meta {
  url: string
  requestedUrl: string
  title: string | null
  viewport: {
    width: number
    height: number
    deviceScaleFactor: number
  }
  timestamp: string
  document: {
    language: string | null
    scrollWidth: number
    scrollHeight: number
    contentType: string
  } | null
  navigation: {
    status: number | null
    statusText: string
  } | null
  notes: string[]
}
```

- `url` is the final URL after redirects; `requestedUrl` is the input URL.
- `timestamp` is an ISO-8601 UTC timestamp recorded when extraction finishes.
- The default viewport is 1440×900 CSS pixels at device scale factor 1, light color scheme,
  `en-US` locale, and normal (not reduced) motion.

## `colors`

```text
Colors {
  items: ColorEntry[]
  inspectedElementCount: number
  notes: string[]
}

ColorEntry {
  color: string
  count: number
  roles: { role: "text" | "background" | "border" | "accent", count: number }[]
  properties: { property: string, count: number }[]
  exampleSelectors: string[]
}
```

`items` is descending by `count`. `color` is Chromium's normalized computed color, normally
`rgb(...)` or `rgba(...)`. Counts represent computed-style property occurrences across elements
and generated `::before`/`::after` content; they are not pixel-area measurements. Colors are read
from color-bearing properties, fills, strokes, shadows, decoration, border images, and background
images. Transparent colors are retained. At most six example selectors are stored per color.

## `typography`

```text
Typography {
  families: FontFamily[]
  notes: string[]
}

FontFamily {
  family: string
  count: number
  variants: FontVariant[]
}

FontVariant {
  size: string
  weight: string
  lineHeight: string
  letterSpacing: string
  fontStyle: string
  count: number
  exampleElement: string
  sampleText: string
}
```

`family` is the complete computed `font-family` stack, not only the first face. Families and their
variants are descending by occurrence count. Typography is collected from visible elements with
direct rendered text, form values/placeholders, image alternative text, and generated content.
`sampleText` is whitespace-normalized and truncated to 160 characters.

## `spacing`

```text
Spacing {
  commonValues: CommonSpacingValue[]
  margins: RankedStyleValue[]
  paddings: RankedStyleValue[]
  containerMaxWidths: RankedStyleValue[]
  borderRadii: RankedStyleValue[]
  boxShadows: RankedStyleValue[]
  notes: string[]
}

CommonSpacingValue {
  value: string
  count: number
  marginCount: number
  paddingCount: number
  exampleSelectors: string[]
}

RankedStyleValue {
  value: string
  count: number
  exampleSelectors: string[]
}
```

All arrays are descending by `count`. Margin and padding counts include each longhand side on each
visible element, including zero. `commonValues` combines both categories while preserving their
separate counts. Max widths omit `none` and `0px`; radii omit `0px`; shadows omit `none`.

## `breakpoints`

```text
Breakpoints {
  items: MediaQueryOccurrence[]
  summary: MediaQuerySummary[]
  stylesheets: StylesheetRecord[]
  notes: string[]
}

MediaQueryOccurrence {
  condition: string
  widths: MediaWidth[]
  source: string
  cssText: string
}

MediaWidth {
  kind: string
  value: number
  unit: "px" | "em" | "rem" | "vw" | string
  approximatePixels: number | null
}

MediaQuerySummary {
  condition: string
  count: number
  widths: MediaWidth[]
  sources: string[]
}

StylesheetRecord {
  source: string
  origin: "document" | "@import"
  crossOrigin: boolean
  status: "parsed" | "failed" | "skipped"
  method: "inline" | "navigation-response" | "browser-request" | "data-url" | "cssom" | "fetch" | null
  statusCode: number | null
  bytes: number | null
  error: string | null
}
```

`items` contains every discovered `@media` occurrence, including nested rules, in stylesheet
traversal order. Its `cssText` is the entire media rule. `summary` groups exact condition strings
and is descending by count. `approximatePixels` converts `em` and `rem` at 16px and is otherwise
`null` when no safe conversion exists.

External sheets are first recovered from responses observed during navigation, then fetched with
the browser context (which shares page cookies). Reachable `@import` URLs are traversed recursively.
Inline sheet sources use `inline://...`; adopted CSSOM-only sheets use `cssom://...`. Raw sheets over
20 MiB and traversal beyond 500 sheets are skipped with notes. If raw access fails, accessible CSSOM
rules remain eligible as a fallback.

## `animations`

```text
Animations {
  keyframes: KeyframesOccurrence[]
  transitions: Transition[]
  unmatchedAnimationUses: AnimationUse[]
  intersectionObserverHints: string[]
  notes: string[]
}

KeyframesOccurrence {
  name: string
  vendorPrefix: string | null
  source: string
  cssText: string
  uses: AnimationUse[]
  ruleUsages: RuleUsage[]
  likelyTriggers: ("load" | "hover" | "focus" | "active" | "scroll")[]
  triggerEvidence: TriggerEvidence[]
}

AnimationUse {
  name: string
  selector: string
  duration: string | null
  delay: string | null
  easing: string | null
  iterationCount: string | null
  direction: string | null
  fillMode: string | null
  playState: string | null
  animationTimeline: string
  intersectionObserved: boolean
}

RuleUsage {
  selector: string
  source: string
  triggers: ("hover" | "focus" | "active" | "scroll")[]
}

TriggerEvidence {
  type: "load" | "hover" | "focus" | "active" | "scroll"
  evidence: string
  source: string
}

Transition {
  selector: string
  properties: string[]
  durations: string[]
  easing: string[]
  delays: string[]
}
```

`keyframes` contains every discovered standard or vendor-prefixed `@keyframes` occurrence; duplicate
names in different sheets remain separate. `cssText` is the exact substring of fetched/inline CSS.
For CSSOM-only sources it is Chromium's serialized rule text. `uses` contains elements whose loaded
computed `animation-name` matches the keyframe. `ruleUsages` also captures inactive state rules such
as hover animations. `unmatchedAnimationUses` records computed names whose definitions could not be
reached.

Transitions include every element or generated pseudo-element with a non-zero computed transition
duration. The four lists preserve CSS list ordering and may have different lengths under CSS cycling
rules.

Triggers are best-effort evidence, not guaranteed behavior. `load` means the animation was active
after initial load without state/scroll evidence. `scroll` is inferred from an observed
IntersectionObserver target, non-default `animation-timeline`, or animation/scroll/view-timeline CSS.

## `backgrounds`

```text
Backgrounds {
  sections: SectionBackground[]
  heroMedia: HeroMedia[]
  notes: string[]
}

SectionBackground {
  sectionSelector: string
  sectionKind: string
  backgroundColor: string
  backgroundImage: string
  imageUrls: string[]
  backgroundSize: string
  backgroundPosition: string
  backgroundRepeat: string
  backgroundAttachment: string
  backgroundOrigin: string
  backgroundClip: string
  backgroundBlendMode: string
  mixBlendMode: string
  filter: string
  backdropFilter: string
}
```

`backgroundImage` preserves Chromium's complete computed gradient/image value. `imageUrls` extracts
all `url(...)` components. There is one background record for every emitted outline section.

`HeroMedia` is one of:

```text
VideoHeroMedia {
  type: "video"
  selector: string
  sectionSelector: string
  approximateWidth: number
  approximateHeight: number
  sourceUrls: string[]
  autoplay: boolean
  muted: boolean
  loop: boolean
  playsInline: boolean
  poster: string | null
}

CanvasHeroMedia {
  type: "canvas" | "webgl-canvas"
  selector: string
  sectionSelector: string
  approximateWidth: number
  approximateHeight: number
  bitmapWidth: number
  bitmapHeight: number
  observedContextTypes: string[]
}
```

Canvas context creation is instrumented before site scripts execute. A canvas is marked
`webgl-canvas` when `webgl` or `webgl2` was requested. Detection covers media in a hero-classified or
above-the-fold major section.

## `inlineSvgs`

```text
InlineSvgs {
  thresholdBytes: 4096
  items: InlineSvg[]
  notes: string[]
}

InlineSvg {
  kind: "verbatim" | "summary"
  selector: string
  id: string | null
  classes: string[]
  byteSize: number
  width: number
  height: number
  viewBox: string | null
  role: string
  accessibleName: string | null
  markup?: string
}
```

`byteSize` is the UTF-8 byte length of serialized `outerHTML`. Items strictly below 4096 bytes use
`kind: "verbatim"` and contain `markup`; larger items use `kind: "summary"` and omit it. `role` is
explicit when supplied and otherwise inferred as `decorative`, `image`, `icon`, or `graphic`.

## `sections`

```text
Sections {
  items: Section[]
  totalCandidates: number
  notes: string[]
}

Section {
  kind: "header" | "nav" | "main" | "hero" | "article" | "section" | string
  selector: string
  tag: string
  id: string | null
  classes: string[]
  role: string | null
  approximateHeight: number
  approximateWidth: number
  documentTop: number
  headings: string[]
  keyComputedStyles: {
    display: string
    position: string
    color: string
    backgroundColor: string
    backgroundImage: string
    fontFamily: string
    fontSize: string
    margin: string
    padding: string
    maxWidth: string
    borderRadius: string
    boxShadow: string
    overflow: string
  }
  structure: {
    directChildren: number
    headings: number
    links: number
    buttons: number
    images: number
  }
  description: string
}
```

Items are a top-level page outline in document order. Major candidates include non-nested landmark
boundaries, primary/header navigation, top-level `section`/`article`/ARIA regions, explicit hero or
masthead blocks, and large full-width direct children of `body` or `main`. Generic wrappers around
other major boundaries, nested content cards/articles, secondary navigation, hidden elements, and
zero-size elements are omitted. `totalCandidates` is the number discovered before visibility and
major-boundary pruning; notes report the visible and emitted counts, and any safety cap. Dimensions
and `documentTop` are rounded CSS pixels. Iframe contents are not traversed; their presence is
recorded in `sections.notes`.
