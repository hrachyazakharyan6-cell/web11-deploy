#!/usr/bin/env bash
# start.sh — runs cleaner in background then runs web11.js in foreground
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

# start cleaner in background (logs to /tmp/clean-history.log)
nohup node ./clean-history.js >/tmp/clean-history.log 2>&1 &

# run your existing web11.js in foreground (Render will keep this process)
exec node web11.js
