#!/bin/bash
# One stream of checks: sweep.sh <tag> <base url> <name[:p]>...   (":p" runs the check on the portrait sample)
S="$(cd "$(dirname "$0")" && pwd)"; tag=$1; export BASE=$2; shift 2
rm -f "$S/out/$tag.done"; sync
for t in "$@"; do
  n=${t%%:*}
  if [ "$t" != "$n" ]; then FILE=raf2/X100VI__DSCF0074.RAF TAG=p timeout 1200 node "$S/$n.cjs" > "$S/out/$tag-${n}p.log" 2>&1
  else timeout 1200 node "$S/$n.cjs" > "$S/out/$tag-$n.log" 2>&1; fi
done
echo finished > "$S/out/$tag.done"
