#!/usr/bin/env python3
"""Test double: first synth hangs then replies late; later synths return immediately."""
from __future__ import annotations

import json
import sys
import time


def emit(payload: dict) -> None:
    sys.stdout.write(json.dumps(payload) + "\n")
    sys.stdout.flush()


def main() -> int:
    emit({"ok": True, "event": "ready", "speaker": "ru_roman"})
    count = 0
    for raw in sys.stdin:
        line = raw.strip()
        if not line:
            continue
        req = json.loads(line)
        req_id = req.get("id")
        cmd = req.get("cmd")
        if cmd == "stop":
            emit({"ok": True, "event": "bye", "id": req_id})
            return 0
        if cmd != "synth":
            emit({"ok": False, "error": "unknown", "id": req_id})
            continue
        count += 1
        if req.get("text") == "first":
            time.sleep(8)
            emit({"ok": True, "duration_ms": 999, "id": req_id, "marker": "late-first"})
            continue
        emit({"ok": True, "duration_ms": 42, "id": req_id, "marker": "second"})
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
