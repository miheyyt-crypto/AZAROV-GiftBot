#!/bin/bash
# Local-only 5-minute bot memory samples for 24h. Does not restart services.
# Metrics: curl 127.0.0.1:3101/metrics only (not public).
set -eu
LOG="${BOT_MEM_SAMPLE_LOG:-/var/tmp/giftbot-bot-mem-24h.tsv}"
ROUNDS="${BOT_MEM_SAMPLE_ROUNDS:-288}"
SLEEP_SEC="${BOT_MEM_SAMPLE_SLEEP:-300}"
PID_FILE=/var/tmp/giftbot-bot-mem-24h.pid
if [[ -f "$PID_FILE" ]] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  echo "already running pid=$(cat "$PID_FILE")" >&2
  exit 1
fi
echo $$ > "$PID_FILE"
trap 'rm -f "$PID_FILE"' EXIT
if [[ ! -f "$LOG" ]]; then
  printf 't_iso\tpid\trss_kB\theapUsed\theapTotal\texternal\tarrayBuffers\tjobs_completed\tjobs_failed\tmemavail_kB\tswapfree_kB\tnrestarts\n' > "$LOG"
fi
i=0
while [[ "$i" -lt "$ROUNDS" ]]; do
  PID=$(systemctl show -p MainPID --value giftbot-bot.service)
  RSS=0
  if [[ -n "$PID" && "$PID" != "0" && -r "/proc/$PID/status" ]]; then
    RSS=$(awk '/^VmRSS:/ {print $2}' "/proc/$PID/status")
  fi
  AVAIL=$(awk '/^MemAvailable:/ {print $2}' /proc/meminfo)
  SFREE=$(awk '/^SwapFree:/ {print $2}' /proc/meminfo)
  NR=$(systemctl show -p NRestarts --value giftbot-bot.service)
  BOT_MEM_METRICS_JSON=$(curl -sS --max-time 2 http://127.0.0.1:3101/metrics || echo '{}')
  export BOT_MEM_METRICS_JSON
  python3 - "$LOG" "$PID" "$RSS" "$AVAIL" "$SFREE" "$NR" <<'PY'
import json, os, sys
from datetime import datetime, timezone
log, pid, rss, avail, sfree, nr = sys.argv[1:]
try:
    body = json.loads(os.environ.get("BOT_MEM_METRICS_JSON") or "{}")
except Exception:
    body = {}
mem = body.get("memory") or {}
ctr = body.get("counters") or {}

def cell(src, key):
    val = src.get(key)
    return "" if val is None else str(int(val))

line = "\t".join([
    datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    pid, rss,
    cell(mem, "heapUsed"), cell(mem, "heapTotal"),
    cell(mem, "external"), cell(mem, "arrayBuffers"),
    cell(ctr, "jobs_completed"), cell(ctr, "jobs_failed"),
    avail, sfree, nr,
])
with open(log, "a", encoding="utf-8") as fh:
    fh.write(line + "\n")
PY
  unset BOT_MEM_METRICS_JSON
  i=$((i + 1))
  if [[ "$i" -lt "$ROUNDS" ]]; then
    sleep "$SLEEP_SEC"
  fi
done
echo "SAMPLE_24H_OK $LOG"
