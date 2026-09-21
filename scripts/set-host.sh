#!/usr/bin/env bash
# Point the PowerPoint add-in manifest at a deployed host.
# Usage: scripts/set-host.sh https://your-app.azurewebsites.net
set -euo pipefail
HOST="${1:?usage: $0 https://host}"
HOST="${HOST%/}"
cd "$(dirname "$0")/.."
# Replace whatever host the manifest currently points at (localhost or a previous deploy).
CURRENT=$(grep -o 'https://[^/"]*/powerpoint-addin/taskpane.html' powerpoint-addin/manifest.xml | head -1 | sed 's|/powerpoint-addin/taskpane.html||')
sed -i '' "s|${CURRENT}|${HOST}|g" powerpoint-addin/manifest.xml
echo "manifest.xml: ${CURRENT} -> ${HOST}"
grep -c "${HOST}" powerpoint-addin/manifest.xml | xargs -I{} echo "{} URLs now point at ${HOST}"
