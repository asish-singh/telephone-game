# Project: telephone-game

A traced visual study of how an instruction degrades as it passes from human intent through an orchestrating agent (Claude) to coding subagents (Codex), published as a GitHub paper with animated diagrams.

## Status

- Started: 2026-07-20
- Current state: just created, spec being written

## Goal

A public GitHub repo that reads as a visual case study. One real build task flows down the chain (Asish's intent, Claude's decomposition, Codex's interpretation, the final code). Every message is logged to a trace file, and each layer's understanding is diffed against the original intent to show where and how meaning drifts. Figures are SVG generated from the real trace, animated with CSS on a GitHub Pages site, with static exports in the README.

## Key rules

- Every arrow in every diagram must come from the real logged trace, never illustrative or invented data.
- No overstating in the paper. It is a practitioner case study of one run, not a research claim.
- Prose style: no em dashes, en dashes, hyphens, or colons in prose (Asish's global rule).
- The supervisor (Claude) never writes the build task's code; Codex subagents implement.

## Planned repo shape

- `paper/` writeup
- `trace/` raw JSONL trace (one line per signal)
- `viz/` Python render scripts (trace in, SVG out)
- `figures/` generated SVGs
- `site/` GitHub Pages page with animated figures

## How to run it

Nothing to run yet. Fill in once the trace logger and viz scripts exist.

## Notes for Claude

- Asish is non-technical: explain in plain language, choose sensible defaults, confirm before anything destructive.
- Commit working checkpoints as you go.
- Keep this file updated as the project evolves (goal, status, how to run).
