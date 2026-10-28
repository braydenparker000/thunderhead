#!/usr/bin/env bash
# Uploads frontend/ to the storage account's $web container and waits until the live
# release.json names this commit. Needs: `az login` done, AZURE_STORAGE_ACCOUNT, SITE_URL.
# Usage: scripts/deploy.sh <commit-sha>
set -euo pipefail
sha="${1:?commit sha}"
account="${AZURE_STORAGE_ACCOUNT:?set AZURE_STORAGE_ACCOUNT}"
site="${SITE_URL:?set SITE_URL}"; site="${site%/}"

out=.deploy/site
rm -rf .deploy && mkdir -p "$out" && cp -R frontend/. "$out/"
printf '{"commit":"%s","deployedAt":"%s"}\n' "$sha" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$out/release.json"

# assets first, pages last, so a visitor never gets a new page that points at old files
az storage blob upload-batch --account-name "$account" --auth-mode login --destination '$web' \
  --source "$out" --pattern 'assets/*' --overwrite --content-cache-control 'no-cache' --only-show-errors --output none
az storage blob upload-batch --account-name "$account" --auth-mode login --destination '$web' \
  --source "$out" --overwrite --content-cache-control 'no-cache' --only-show-errors --output none

for attempt in 1 2 3 4 5 6 7 8 9 10; do
  if curl -fsS "$site/release.json?t=$attempt" | grep -q "\"commit\":\"$sha\""; then
    echo "live: $sha"
    exit 0
  fi
  sleep 3
done
echo "the live site does not report $sha" >&2
exit 1
