#!/usr/bin/env python3
"""Render the four telephone-game study figures as standalone SVG.

Reads only:
  - trace/run-01.jsonl        (18 logged signals)
  - trace/analysis/run-01/drift.json  (per-requirement fates, invented items, recoveries)

Writes:
  - figures/lineage.svg
  - figures/connectome.svg
  - figures/timeline.svg
  - figures/drift-table.svg

Stdlib only. No hardcoded findings: every data-bearing value in the
figures comes from the two input files above. Layout constants (margins,
column x-positions, actor list/order, palette) are the only hardcoded
things, per the assignment.
"""

import json
import os
import xml.etree.ElementTree as ET

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TRACE_PATH = os.path.join(ROOT, "trace", "run-01.jsonl")
DRIFT_PATH = os.path.join(ROOT, "trace", "analysis", "run-01", "drift.json")
FIGURES_DIR = os.path.join(ROOT, "figures")

FONT = "ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif"
CHAR_W = 7.0  # rough px-per-char at 12px font, per assignment guidance

# Fixed layout constant: known actor roster (order used for connectome/timeline rows).
ACTORS = ["asish", "claude", "codex-1", "codex-2"]

FATE_COLOR = {
    "preserved": "#22c55e",
    "mutated": "#f59e0b",
    "dropped": "#ef4444",
    "invented": "#8b5cf6",
    "unknown": "#9ca3af",
}

SIGNAL_TYPE_COLOR = {
    "intent": "#3b82f6",
    "decomposition": "#8b5cf6",
    "instruction": "#0ea5e9",
    "artifact": "#22c55e",
    "review": "#f59e0b",
    "correction": "#ef4444",
    "resubmission": "#14b8a6",
    "acceptance": "#22c55e",
    "handoff": "#6366f1",
}


def load_data():
    signals = []
    with open(TRACE_PATH, "r") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            signals.append(json.loads(line))
    with open(DRIFT_PATH, "r") as fh:
        drift = json.load(fh)
    return signals, drift


def esc(s):
    return (
        str(s)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def text_width(s, size):
    return len(s) * CHAR_W * (size / 12.0)


def wrap_text(s, size, max_width):
    """Greedy word wrap to fit max_width at given font size."""
    words = s.split()
    lines = []
    cur = ""
    for w in words:
        cand = (cur + " " + w).strip()
        if text_width(cand, size) <= max_width or not cur:
            cur = cand
        else:
            lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines


class SVG:
    def __init__(self, width, height, bg=None):
        self.width = width
        self.height = height
        self.elems = []
        self.defs = []
        if bg:
            self.elems.append(
                f'<rect x="0" y="0" width="{width}" height="{height}" fill="{bg}"/>'
            )

    def add(self, s):
        self.elems.append(s)

    def add_def(self, s):
        self.defs.append(s)

    def rect(self, x, y, w, h, fill, rx=0, opacity=1, stroke=None, stroke_width=1):
        s = (
            f'<rect x="{x:.2f}" y="{y:.2f}" width="{w:.2f}" height="{h:.2f}" '
            f'rx="{rx}" fill="{fill}" opacity="{opacity}"'
        )
        if stroke:
            s += f' stroke="{stroke}" stroke-width="{stroke_width}"'
        s += "/>"
        self.add(s)

    def text(self, x, y, s, size=12, fill="#111827", anchor="start", weight="normal", family=None):
        fam = family or FONT
        self.add(
            f'<text x="{x:.2f}" y="{y:.2f}" font-family="{fam}" font-size="{size}" '
            f'fill="{fill}" text-anchor="{anchor}" font-weight="{weight}">{esc(s)}</text>'
        )

    def line(self, x1, y1, x2, y2, stroke, width=1, opacity=1, dash=None):
        d = f' stroke-dasharray="{dash}"' if dash else ""
        self.add(
            f'<line x1="{x1:.2f}" y1="{y1:.2f}" x2="{x2:.2f}" y2="{y2:.2f}" '
            f'stroke="{stroke}" stroke-width="{width}" opacity="{opacity}"{d}/>'
        )

    def circle(self, cx, cy, r, fill, opacity=1, stroke=None, stroke_width=1, filt=None):
        s = f'<circle cx="{cx:.2f}" cy="{cy:.2f}" r="{r:.2f}" fill="{fill}" opacity="{opacity}"'
        if stroke:
            s += f' stroke="{stroke}" stroke-width="{stroke_width}"'
        if filt:
            s += f' filter="url(#{filt})"'
        s += "/>"
        self.add(s)

    def path(self, d, stroke=None, fill="none", width=1, opacity=1, marker_end=None):
        s = f'<path d="{d}" stroke="{stroke or "none"}" fill="{fill}" stroke-width="{width}" opacity="{opacity}"'
        if marker_end:
            s += f' marker-end="url(#{marker_end})"'
        s += "/>"
        self.add(s)

    def polygon(self, points, fill, stroke=None, stroke_width=1):
        pts = " ".join(f"{x:.2f},{y:.2f}" for x, y in points)
        s = f'<polygon points="{pts}" fill="{fill}"'
        if stroke:
            s += f' stroke="{stroke}" stroke-width="{stroke_width}"'
        s += "/>"
        self.add(s)

    def render(self):
        defs = ""
        if self.defs:
            defs = "<defs>" + "".join(self.defs) + "</defs>"
        body = "".join(self.elems)
        return (
            f'<svg xmlns="http://www.w3.org/2000/svg" width="{self.width}" '
            f'height="{self.height}" viewBox="0 0 {self.width} {self.height}">'
            f"{defs}{body}</svg>"
        )


def write_svg(svg, path):
    xml_str = svg.render()
    with open(path, "w") as fh:
        fh.write(xml_str)
    # Verify well-formed XML.
    ET.fromstring(xml_str)
    return path


# ---------------------------------------------------------------------------
# Figure 1: lineage.svg (Sankey-style strand flow)
# ---------------------------------------------------------------------------

def build_lineage(signals, drift):
    requirements = drift["requirements"]
    recoveries = drift.get("recoveries", [])

    label_w = 230
    margin_left = 20
    margin_right = 40
    margin_top = 70
    margin_bottom = 40
    col_gap = 190
    row_h = 46

    n_rows = len(requirements)
    plot_left = margin_left + label_w
    columns = ["S0", "S1", "S2", "S3"]
    col_titles = {
        "S0": "Intent (S0)",
        "S1": "Decomposition (S1)",
        "S2": "Subagents (S2)",
        "S3": "Code (S3)",
    }
    col_x = {c: plot_left + i * col_gap for i, c in enumerate(columns)}
    width = col_x["S3"] + margin_right + 20
    height = margin_top + n_rows * row_h + margin_bottom + 90

    svg = SVG(width, height, bg="#ffffff")

    svg.text(margin_left, 30, "Lineage flow: requirement fate across layers", size=17, weight="bold")
    svg.text(
        margin_left, 50,
        "Each strand is one S0 requirement; color = fate at that layer.",
        size=12, fill="#4b5563",
    )

    # Column headers.
    for c in columns:
        svg.text(col_x[c], margin_top - 24, col_titles[c], size=12, weight="bold", anchor="middle", fill="#111827")

    # Build seq lookup for recovery markers by requirement id token (e.g. "R7").
    req_to_recoveries = {}
    for rec in recoveries:
        req_field = rec.get("requirement", "")
        for tok in req_field.replace("/", ",").split(","):
            tok = tok.strip()
            if tok:
                req_to_recoveries.setdefault(tok, []).append(rec["seq"])

    strand_half = 8

    for idx, req in enumerate(requirements):
        y = margin_top + idx * row_h + row_h / 2
        rid = req["id"]
        name = req["name"]
        fates = req["fates"]
        # fate sequence per column: S0 always "preserved" (the origin), then S1,S2,S3
        col_fate = ["preserved", fates.get("S1", "unknown"), fates.get("S2", "unknown"), fates.get("S3", "unknown")]

        # label at left
        svg.text(margin_left, y + 4, f"{rid} — {name}", size=12, fill="#111827")

        # strand segments between consecutive columns, colored by the fate of
        # the layer being entered (segment i uses col_fate[i+1] color, i.e.
        # fate at the destination layer), so a color change lands at the column.
        for i in range(len(columns) - 1):
            x1 = col_x[columns[i]]
            x2 = col_x[columns[i + 1]]
            fate = col_fate[i + 1]
            color = FATE_COLOR.get(fate, FATE_COLOR["unknown"])
            svg.rect(x1, y - strand_half, x2 - x1, strand_half * 2, fill=color, rx=strand_half, opacity=0.9)

        # node dots at each column colored by fate at that column
        for i, c in enumerate(columns):
            fate = col_fate[i]
            color = FATE_COLOR.get(fate, FATE_COLOR["unknown"])
            svg.circle(col_x[c], y, 6, fill=color, stroke="#ffffff", stroke_width=1.5)

        # recovery markers: diamonds placed at the S2->S3 midpoint region with seq label
        seqs = req_to_recoveries.get(rid, [])
        for seq in seqs:
            mx = (col_x["S2"] + col_x["S3"]) / 2
            my = y
            d = 7
            svg.polygon(
                [(mx, my - d), (mx + d, my), (mx, my + d), (mx - d, my)],
                fill="#111827",
                stroke="#ffffff",
                stroke_width=1.5,
            )
            svg.text(mx, my - d - 5, f"seq {seq}", size=9, anchor="middle", fill="#111827", weight="bold")

    # Legend.
    legend_y = margin_top + n_rows * row_h + 30
    legend_items = [("preserved", FATE_COLOR["preserved"]), ("mutated", FATE_COLOR["mutated"]),
                    ("dropped", FATE_COLOR["dropped"]), ("recovery event", "#111827")]
    lx = margin_left
    for label, color in legend_items:
        if label == "recovery event":
            svg.polygon([(lx + 6, legend_y - 6), (lx + 12, legend_y), (lx + 6, legend_y + 6), (lx, legend_y)],
                        fill=color, stroke="#ffffff", stroke_width=1)
        else:
            svg.circle(lx + 6, legend_y, 6, fill=color)
        svg.text(lx + 18, legend_y + 4, label, size=11, fill="#111827")
        lx += 18 + text_width(label, 11) + 26

    return write_svg(svg, os.path.join(FIGURES_DIR, "lineage.svg"))


# ---------------------------------------------------------------------------
# Figure 2: connectome.svg (dark, glowing node graph)
# ---------------------------------------------------------------------------

def build_connectome(signals, drift):
    width, height = 760, 560
    svg = SVG(width, height, bg="#0b0f1a")

    # glow filter
    svg.add_def(
        '<filter id="glow" x="-100%" y="-100%" width="300%" height="300%">'
        '<feGaussianBlur stdDeviation="6" result="blur"/>'
        '<feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>'
        "</filter>"
    )
    svg.add_def(
        '<filter id="glow-soft" x="-100%" y="-100%" width="300%" height="300%">'
        '<feGaussianBlur stdDeviation="10" result="blur"/>'
        '<feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>'
        "</filter>"
    )

    nodes = set(ACTORS) | {"repo"}
    pair_counts = {}
    touch_counts = {n: 0 for n in nodes}

    for sig in signals:
        f, t = sig.get("from"), sig.get("to")
        for n in (f, t):
            if n in touch_counts:
                touch_counts[n] += 1
        if f in nodes and t in nodes and f != t:
            key = tuple(sorted((f, t)))
            pair_counts[key] = pair_counts.get(key, 0) + 1

    # repo isn't a from/to in the trace (no signals target it directly), but
    # we still show it as a node representing the artifact destination of
    # 'artifact'/'acceptance' type signals, sized by how many such signals
    # touch code state.
    artifact_types = {"artifact", "acceptance", "resubmission"}
    repo_touches = sum(1 for s in signals if s.get("type") in artifact_types)
    touch_counts["repo"] = repo_touches

    positions = {
        "claude": (width / 2, height / 2 - 20),
        "asish": (width / 2 - 260, height / 2 - 120),
        "codex-1": (width / 2 + 250, height / 2 - 130),
        "codex-2": (width / 2 + 250, height / 2 + 150),
        "repo": (width / 2 - 240, height / 2 + 170),
    }

    max_pair = max(pair_counts.values()) if pair_counts else 1
    max_touch = max(touch_counts.values()) if touch_counts else 1

    svg.text(28, 34, "Connectome: who talked to whom", size=17, weight="bold", fill="#e5e7eb")
    svg.text(28, 54, "Edge width = message count between the pair. Node size = total signals touched.",
             size=12, fill="#9ca3af")

    # Draw repo edge separately: connect repo to claude/codex nodes proportional to artifact-type signals.
    repo_edges = {}
    for s in signals:
        if s.get("type") in artifact_types:
            f = s.get("from")
            if f in positions and f != "repo":
                key = tuple(sorted((f, "repo")))
                repo_edges[key] = repo_edges.get(key, 0) + 1
    all_edges = dict(pair_counts)
    for k, v in repo_edges.items():
        all_edges[k] = all_edges.get(k, 0) + v
    max_edge = max(all_edges.values()) if all_edges else 1

    # edges first (under nodes)
    for (a, b), count in all_edges.items():
        if a not in positions or b not in positions:
            continue
        x1, y1 = positions[a]
        x2, y2 = positions[b]
        w = 1.5 + (count / max_edge) * 9
        svg.line(x1, y1, x2, y2, stroke="#6366f1", width=w, opacity=0.55)
        mx, my = (x1 + x2) / 2, (y1 + y2) / 2
        svg.rect(mx - 14, my - 10, 28, 16, fill="#0b0f1a", rx=4, opacity=0.85)
        svg.text(mx, my + 3, str(count), size=11, anchor="middle", fill="#c7d2fe")

    node_colors = {
        "asish": "#f59e0b",
        "claude": "#38bdf8",
        "codex-1": "#22c55e",
        "codex-2": "#a78bfa",
        "repo": "#f472b6",
    }

    for name, (x, y) in positions.items():
        touch = touch_counts.get(name, 0)
        r = 16 + (touch / max_touch) * 30
        color = node_colors.get(name, "#e5e7eb")
        svg.circle(x, y, r + 6, fill=color, opacity=0.25, filt="glow-soft")
        svg.circle(x, y, r, fill=color, opacity=0.9, stroke="#0b0f1a", stroke_width=2, filt="glow")
        svg.text(x, y - r - 12, name, size=13, anchor="middle", fill="#f9fafb", weight="bold")
        svg.text(x, y + 4, str(touch), size=11, anchor="middle", fill="#0b0f1a", weight="bold")

    # legend
    ly = height - 30
    svg.text(28, ly, "Node label = actor, number in node = total signals touched. Number on edge = message count.",
             size=11, fill="#9ca3af")

    return write_svg(svg, os.path.join(FIGURES_DIR, "connectome.svg")), pair_counts


# ---------------------------------------------------------------------------
# Figure 3: timeline.svg (raster / spike plot)
# ---------------------------------------------------------------------------

def build_timeline(signals):
    margin_left = 110
    margin_right = 40
    margin_top = 70
    margin_bottom = 130
    row_h = 70
    col_gap = 46  # px per seq step

    n = len(signals)
    plot_w = (n - 1) * col_gap
    width = margin_left + plot_w + margin_right + 20
    height = margin_top + len(ACTORS) * row_h + margin_bottom

    svg = SVG(width, height, bg="#ffffff")
    svg.text(margin_left, 30, "Firing timeline: one tick per signal, by actor and sequence", size=17, weight="bold")
    svg.text(margin_left, 50, "X axis is sequence order (seq), not wall time. Corrections and reviews are emphasized.",
             size=12, fill="#4b5563")

    row_y = {actor: margin_top + i * row_h + row_h / 2 for i, actor in enumerate(ACTORS)}

    # row baselines + labels
    for actor in ACTORS:
        y = row_y[actor]
        svg.line(margin_left, y, margin_left + plot_w, y, stroke="#e5e7eb", width=1)
        svg.text(margin_left - 12, y + 4, actor, size=12, anchor="end", weight="bold")

    def seq_x(seq):
        return margin_left + (seq - 1) * col_gap

    # sparse timestamp labels: first, last, and every 4th
    for i, sig in enumerate(signals):
        seq = sig["seq"]
        if i == 0 or i == n - 1 or seq % 4 == 0:
            x = seq_x(seq)
            ts = sig["ts"].split("T")[1][:8]
            svg.text(x, margin_top - 34, ts, size=9, anchor="middle", fill="#6b7280")
            svg.line(x, margin_top - 30, x, margin_top - 24, stroke="#9ca3af", width=1)

    emphasized = {"correction", "review"}

    # correction -> resubmission arcs (correction seq to the next resubmission seq from same target actor)
    corrections = [s for s in signals if s["type"] == "correction"]
    resubs = [s for s in signals if s["type"] == "resubmission"]
    arcs = []
    for c in corrections:
        target = c["to"]
        candidates = [r for r in resubs if r["seq"] > c["seq"] and r["from"] == target]
        if candidates:
            nearest = min(candidates, key=lambda r: r["seq"])
            arcs.append((c, nearest))

    for c, r in arcs:
        x1 = seq_x(c["seq"])
        x2 = seq_x(r["seq"])
        y = row_y.get(c["to"], row_y[ACTORS[0]])
        peak = y - 30
        mx = (x1 + x2) / 2
        svg.path(f"M {x1:.2f} {y:.2f} Q {mx:.2f} {peak:.2f} {x2:.2f} {y:.2f}",
                 stroke="#ef4444", width=1.4, opacity=0.6)

    # ticks
    for sig in signals:
        actor = sig["from"]
        if actor not in row_y:
            continue
        x = seq_x(sig["seq"])
        y = row_y[actor]
        typ = sig["type"]
        color = SIGNAL_TYPE_COLOR.get(typ, "#6b7280")
        is_emph = typ in emphasized
        h = 26 if is_emph else 14
        w = 3.4 if is_emph else 2.2
        svg.line(x, y - h, x, y + h, stroke=color, width=w, opacity=1 if is_emph else 0.85)
        if is_emph:
            svg.circle(x, y - h - 6, 3, fill=color)
        svg.text(x, y + h + 14, str(sig["seq"]), size=8, anchor="middle", fill="#9ca3af")

    # legend
    legend_y = margin_top + len(ACTORS) * row_h + 40
    lx = margin_left
    svg.text(margin_left, legend_y - 18, "Signal type:", size=11, weight="bold", fill="#111827")
    for typ, color in SIGNAL_TYPE_COLOR.items():
        emph = typ in emphasized
        svg.line(lx, legend_y, lx, legend_y - (18 if emph else 10), stroke=color, width=3 if emph else 2)
        svg.text(lx + 8, legend_y, typ, size=10, fill="#111827")
        lx += 8 + text_width(typ, 10) + 24

    svg.text(margin_left, legend_y + 26,
             "Thin red arcs connect a correction to its resubmission.", size=10, fill="#6b7280")

    return write_svg(svg, os.path.join(FIGURES_DIR, "timeline.svg"))


# ---------------------------------------------------------------------------
# Figure 4: drift-table.svg
# ---------------------------------------------------------------------------

def build_drift_table(drift):
    requirements = drift["requirements"]
    columns = ["S1", "S2", "S3"]

    margin_left = 30
    margin_top = 70
    margin_right = 30
    row_h = 34
    header_h = 30
    name_col_w = 300
    chip_col_w = 90

    table_w = name_col_w + chip_col_w * len(columns)
    width = margin_left + table_w + margin_right
    table_top = margin_top + header_h

    # mutation notes area at bottom for mutated requirements
    mutated_reqs = [r for r in requirements if any(v == "mutated" for v in r["fates"].values())]

    notes_top = table_top + len(requirements) * row_h + 30
    max_note_width = width - margin_left * 2
    note_line_h = 15
    notes_blocks = []
    y_cursor = notes_top + 18
    for r in mutated_reqs:
        header = f'{r["id"]} — {r["name"]}: mutation notes'
        lines = wrap_text(r["mutation_notes"], 11, max_note_width)
        notes_blocks.append((header, lines))
        y_cursor += 18 + len(lines) * note_line_h + 14

    height = y_cursor + 20

    svg = SVG(width, height, bg="#ffffff")
    svg.text(margin_left, 30, "Drift table: requirement fate by layer", size=17, weight="bold")
    svg.text(margin_left, 50, "Chips colored by fate at each layer. Notes below cover mutated requirements.",
             size=12, fill="#4b5563")

    # header row
    svg.text(margin_left, table_top - 8, "Requirement", size=12, weight="bold")
    for i, c in enumerate(columns):
        cx = margin_left + name_col_w + i * chip_col_w + chip_col_w / 2
        svg.text(cx, table_top - 8, c, size=12, weight="bold", anchor="middle")

    for idx, req in enumerate(requirements):
        y = table_top + idx * row_h
        row_bg = "#f9fafb" if idx % 2 == 0 else "#ffffff"
        svg.rect(margin_left, y, table_w, row_h, fill=row_bg)
        label = f'{req["id"]} — {req["name"]}'
        # truncate/ensure fits name_col_w
        max_chars = int(name_col_w / CHAR_W) - 2
        if len(label) > max_chars:
            label = label[: max_chars - 1] + "…"
        svg.text(margin_left + 6, y + row_h / 2 + 4, label, size=12)

        for i, c in enumerate(columns):
            fate = req["fates"].get(c, "unknown")
            color = FATE_COLOR.get(fate, FATE_COLOR["unknown"])
            cx = margin_left + name_col_w + i * chip_col_w + chip_col_w / 2
            chip_w, chip_h = 70, 20
            svg.rect(cx - chip_w / 2, y + row_h / 2 - chip_h / 2, chip_w, chip_h, fill=color, rx=6, opacity=0.9)
            svg.text(cx, y + row_h / 2 + 4, fate, size=10, anchor="middle", fill="#111827", weight="bold")

    # bottom border of table
    svg.line(margin_left, table_top + len(requirements) * row_h, margin_left + table_w,
             table_top + len(requirements) * row_h, stroke="#d1d5db", width=1)

    # notes
    y = notes_top
    for header, lines in notes_blocks:
        svg.text(margin_left, y, header, size=12, weight="bold", fill="#111827")
        y += 18
        for line in lines:
            svg.text(margin_left, y, line, size=11, fill="#374151")
            y += note_line_h
        y += 14

    return write_svg(svg, os.path.join(FIGURES_DIR, "drift-table.svg"))


def main():
    os.makedirs(FIGURES_DIR, exist_ok=True)
    signals, drift = load_data()

    written = []
    written.append(build_lineage(signals, drift))
    connectome_path, pair_counts = build_connectome(signals, drift)
    written.append(connectome_path)
    written.append(build_timeline(signals))
    written.append(build_drift_table(drift))

    print("Wrote:")
    for p in written:
        print(f"  {os.path.relpath(p, ROOT)}")

    print("\nPairwise message counts (from/to, unordered, from-!=-to signals):")
    for (a, b), count in sorted(pair_counts.items(), key=lambda kv: -kv[1]):
        print(f"  {a} <-> {b}: {count}")


if __name__ == "__main__":
    main()
