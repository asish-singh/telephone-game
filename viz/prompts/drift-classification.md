# Drift classification protocol (run by a neutral model that took no part in the build)

Inputs, the snapshots S0, S1, S2-codex-1, S2-codex-2, S3 in trace/snapshots/run-01/, and the signal log trace/run-01.jsonl (summaries and payloads under trace/payloads/run-01/).

Step 1. From S0 only, extract the canonical requirement list, every required behavior, constraint, and quality bar the original intent contains. Give each a stable id (R1, R2, ...) and a short name.

Step 2. For each canonical requirement, examine each later snapshot (S1, S2 combined view, S3) and classify its fate at that layer:
- preserved, present with the same meaning
- mutated, present but meaning changed (say exactly how)
- dropped, absent
- invented is used for items present at a layer that trace to no S0 requirement (list these separately per layer)

Step 3. Recovery linkage. For every correction signal in the trace (types review/correction), state which requirement id it protected or restored, citing the seq numbers.

Step 4. Output two files.
- trace/analysis/run-01/drift.md, a readable report, requirement table (id, name, fate at S1, S2, S3, notes), invented items per layer, recovery table (seq, requirement, what happened), and a short findings summary in plain language.
- trace/analysis/run-01/drift.json, machine readable, {requirements: [{id, name, s0_text, fates: {S1, S2, S3}, mutation_notes}], invented: [{layer, text}], recoveries: [{seq, requirement, note}]}. Fates use exactly preserved|mutated|dropped.

Judge meaning, not wording. A requirement rephrased but intact is preserved. Be strict about silent narrowing (e.g. "web or desktop app" becoming "CLI" is a mutation).
