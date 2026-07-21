#!/usr/bin/env python3
"""Read/write the Storyboard performance-bias preference.

Single cross-tool source of truth: ~/.storyboard/perf-preference.json
Readable/writable by Cursor, Claude Code, and Codex (plain home-dir file).

Usage:
    perf_pref.py get              # prints "quality" | "fast" | "unset" (exit 0)
    perf_pref.py set quality      # persist bias=quality
    perf_pref.py set fast [SOURCE]  # persist bias=fast (SOURCE default "override")
    perf_pref.py reset            # delete the file (back to unset/default)

File format:
    { "bias": "quality"|"fast", "set_at": "<iso8601>", "source": "<str>" }
"""
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

PREF_PATH = Path.home() / ".storyboard" / "perf-preference.json"
VALID_BIAS = ("quality", "fast")


def read_bias() -> str:
    """Return the stored bias, or 'unset' when missing/corrupt/invalid."""
    try:
        data = json.loads(PREF_PATH.read_text(encoding="utf-8"))
    except (FileNotFoundError, ValueError, OSError):
        return "unset"
    bias = data.get("bias")
    return bias if bias in VALID_BIAS else "unset"


def write_bias(bias: str, source: str = "override") -> None:
    """Persist the bias with a UTC timestamp and provenance."""
    if bias not in VALID_BIAS:
        raise ValueError(f"bias must be one of {VALID_BIAS}, got {bias!r}")
    PREF_PATH.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "bias": bias,
        "set_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "source": source,
    }
    PREF_PATH.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def reset() -> None:
    """Remove the preference file if present (idempotent)."""
    try:
        PREF_PATH.unlink()
    except FileNotFoundError:
        pass


def main(argv: list[str]) -> int:
    if not argv:
        print("usage: perf_pref.py <get|set|reset> [bias] [source]", file=sys.stderr)
        return 2

    cmd = argv[0]
    if cmd == "get":
        print(read_bias())
        return 0
    if cmd == "reset":
        reset()
        print("unset")
        return 0
    if cmd == "set":
        if len(argv) < 2 or argv[1] not in VALID_BIAS:
            print("usage: perf_pref.py set <quality|fast> [source]", file=sys.stderr)
            return 2
        source = argv[2] if len(argv) > 2 else "override"
        write_bias(argv[1], source)
        print(argv[1])
        return 0

    print(f"unknown command: {cmd}", file=sys.stderr)
    return 2


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
