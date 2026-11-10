#!/bin/bash
# Freezes the working tree's site into a copy beside these scripts and serves it on port 8081, so a long run of
# checks reads one version of the site while the tree goes on changing (BASE=http://127.0.0.1:8081).
S="$(cd "$(dirname "$0")" && pwd)"; R="$(cd "$S/../../.." && pwd)"
pkill -f "snap/scripts/serve.mjs" 2>/dev/null
rm -rf "$S/snap"; mkdir -p "$S/snap"
cp -r "$R/scripts" "$S/snap/scripts"; cp -r "$R/frontend" "$S/snap/frontend"; cp "$R/package.json" "$S/snap/" 2>/dev/null
(cd "$S/snap" && PORT=8081 nohup node scripts/serve.mjs > "$S/snap.log" 2>&1 < /dev/null &) > /dev/null 2>&1
node -e "setTimeout(()=>{},2000)"; curl -s -o /dev/null -w "snapshot %{http_code}\n" http://127.0.0.1:8081/lab/editor/index.html
