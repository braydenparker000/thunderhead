#!/bin/bash
# Freezes the working tree's site into a snapshot and serves it on port 8081, so checks can run on it while the tree changes.
S=/tmp/claude-0/-home-user/c2fb5e7f-e1c5-5483-8de7-5c9b6e01cdc8/scratchpad
pkill -f "snap/scripts/serve.mjs" 2>/dev/null
rm -rf "$S/snap"; mkdir -p "$S/snap"
cp -r /home/user/thunderhead/scripts "$S/snap/scripts"; cp -r /home/user/thunderhead/frontend "$S/snap/frontend"; cp /home/user/thunderhead/package.json "$S/snap/" 2>/dev/null
(cd "$S/snap" && PORT=8081 nohup node scripts/serve.mjs > "$S/snap.log" 2>&1 &)
node -e "setTimeout(()=>{},2000)"; curl -s -o /dev/null -w "snapshot %{http_code}\n" http://127.0.0.1:8081/lab/editor/index.html
