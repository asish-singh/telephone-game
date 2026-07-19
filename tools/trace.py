#!/usr/bin/env python3
"""Trace logger for the Telephone Game study.

Appends signal events to a JSONL trace file and stores full message
texts as payload files. The trace is append only by design; there is
deliberately no edit or delete command.

Usage:
  python3 tools/trace.py log --run run-01 --sender claude --to codex-1 \
      --type instruction --summary "Issued subtask A" --payload payload.md
  python3 tools/trace.py log --run run-01 --sender asish --to claude \
      --type intent --summary "Original ask" --payload-text "Build me ..."
  python3 tools/trace.py validate --run run-01
  python3 tools/trace.py show --run run-01
"""

import argparse
import datetime
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
TRACE_DIR = ROOT / "trace"

TYPES = [
    "intent", "decomposition", "instruction", "question", "answer",
    "progress", "artifact", "review", "correction", "resubmission",
    "acceptance", "handoff",
]

ACTOR_RE = re.compile(r"^(asish|claude|repo|codex-\d+)$")


def trace_path(run):
    return TRACE_DIR / f"{run}.jsonl"


def payload_dir(run):
    return TRACE_DIR / "payloads" / run


def read_events(run):
    path = trace_path(run)
    if not path.exists():
        return []
    events = []
    with open(path) as f:
        for i, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue
            try:
                events.append(json.loads(line))
            except json.JSONDecodeError as e:
                sys.exit(f"corrupt trace at line {i}: {e}")
    return events


def cmd_log(args):
    for actor, label in [(args.sender, "--sender"), (args.to, "--to")]:
        if not ACTOR_RE.match(actor):
            sys.exit(f"{label} must be asish, claude, repo, or codex-<n>, got {actor!r}")
    if args.type not in TYPES:
        sys.exit(f"--type must be one of {', '.join(TYPES)}")
    if bool(args.payload) == bool(args.payload_text):
        sys.exit("provide exactly one of --payload (a file) or --payload-text")

    events = read_events(args.run)
    seq = events[-1]["seq"] + 1 if events else 1

    pdir = payload_dir(args.run)
    pdir.mkdir(parents=True, exist_ok=True)
    payload_file = pdir / f"{seq:04d}.md"
    if args.payload:
        text = pathlib.Path(args.payload).read_text()
    else:
        text = args.payload_text
    payload_file.write_text(text)

    event = {
        "ts": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "seq": seq,
        "from": args.sender,
        "to": args.to,
        "type": args.type,
        "summary": args.summary,
        "payload_ref": str(payload_file.relative_to(ROOT)),
    }
    TRACE_DIR.mkdir(parents=True, exist_ok=True)
    with open(trace_path(args.run), "a") as f:
        f.write(json.dumps(event) + "\n")
    print(f"logged seq {seq}: {args.sender} -> {args.to} [{args.type}] {args.summary}")


def cmd_validate(args):
    events = read_events(args.run)
    if not events:
        sys.exit(f"no events found for run {args.run!r}")
    errors = []
    prev_seq = 0
    prev_ts = None
    for e in events:
        where = f"seq {e.get('seq', '?')}"
        for field in ["ts", "seq", "from", "to", "type", "summary", "payload_ref"]:
            if field not in e:
                errors.append(f"{where}: missing field {field!r}")
        if e.get("seq") != prev_seq + 1:
            errors.append(f"{where}: sequence gap (expected {prev_seq + 1})")
        prev_seq = e.get("seq", prev_seq)
        if e.get("type") not in TYPES:
            errors.append(f"{where}: unknown type {e.get('type')!r}")
        for side in ["from", "to"]:
            if not ACTOR_RE.match(str(e.get(side, ""))):
                errors.append(f"{where}: bad actor in {side!r}: {e.get(side)!r}")
        ts = e.get("ts")
        if prev_ts and ts and ts < prev_ts:
            errors.append(f"{where}: timestamp goes backwards")
        prev_ts = ts
        ref = e.get("payload_ref")
        if ref and not (ROOT / ref).exists():
            errors.append(f"{where}: payload file missing: {ref}")
    if errors:
        print("\n".join(errors))
        sys.exit(f"INVALID: {len(errors)} problem(s) in {len(events)} events")
    print(f"OK: {len(events)} events, schema valid, payloads present")


def cmd_show(args):
    for e in read_events(args.run):
        print(f"{e['seq']:>4}  {e['ts'][11:19]}  {e['from']:>8} -> {e['to']:<8} "
              f"{e['type']:<13} {e['summary']}")


def main():
    p = argparse.ArgumentParser(description=__doc__)
    sub = p.add_subparsers(dest="cmd", required=True)

    lp = sub.add_parser("log", help="append one signal event")
    lp.add_argument("--run", required=True)
    lp.add_argument("--sender", required=True, help="asish, claude, repo, or codex-<n>")
    lp.add_argument("--to", required=True)
    lp.add_argument("--type", required=True)
    lp.add_argument("--summary", required=True)
    lp.add_argument("--payload", help="file containing the full message text")
    lp.add_argument("--payload-text", help="full message text inline")
    lp.set_defaults(func=cmd_log)

    vp = sub.add_parser("validate", help="check trace integrity")
    vp.add_argument("--run", required=True)
    vp.set_defaults(func=cmd_validate)

    sp = sub.add_parser("show", help="print the trace as a readable table")
    sp.add_argument("--run", required=True)
    sp.set_defaults(func=cmd_show)

    args = p.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
