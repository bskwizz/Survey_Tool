#!/usr/bin/env bash
# One-command deploy of the whole app (API + participant app + dashboard +
# PowerPoint add-in files) to a single Azure App Service (Linux, Node).
#
# Usage:
#   scripts/deploy-azure.sh <app-name> [resource-group] [location] [sku]
# Env (optional): AI_API_KEY to enable Claude synthesis; otherwise mock.
#
# Re-running is safe: create steps are idempotent and the final step just
# redeploys the current working tree.
set -euo pipefail
APP="${1:?usage: $0 <globally-unique-app-name> [rg] [location] [sku]}"
RG="${2:-classroom-survey-rg}"
LOC="${3:-eastus}"
SKU="${4:-B1}"
PLAN="${APP}-plan"
RUNTIME="${RUNTIME:-NODE:22-lts}"
cd "$(dirname "$0")/.."

echo "==> resource group $RG ($LOC)"
az group show -n "$RG" -o none 2>/dev/null || az group create -n "$RG" -l "$LOC" -o none
echo "==> app service plan $PLAN ($SKU, Linux, $LOC)"
# Basic-tier quota is per region and often zero on new subscriptions; if this
# fails, retry with a different location argument (e.g. westus2).
az appservice plan show -g "$RG" -n "$PLAN" -o none 2>/dev/null \
  || az appservice plan create -g "$RG" -n "$PLAN" -l "$LOC" --is-linux --sku "$SKU" -o none
echo "==> web app $APP ($RUNTIME)"
az webapp show -g "$RG" -n "$APP" -o none 2>/dev/null \
  || az webapp create -g "$RG" -p "$PLAN" -n "$APP" --runtime "$RUNTIME" -o none

HOST="https://${APP}.azurewebsites.net"
gen() { python3 -c 'import secrets; print(secrets.token_urlsafe(48))'; }
# Keep existing secrets on redeploy so instructor logins and participant tokens survive.
existing() { az webapp config appsettings list -g "$RG" -n "$APP" --query "[?name=='$1'].value | [0]" -o tsv; }
JWT_SECRET="$(existing JWT_SECRET)"; [ -n "$JWT_SECRET" ] || JWT_SECRET="$(gen)"
PT_SECRET="$(existing PARTICIPANT_TOKEN_SECRET)"; [ -n "$PT_SECRET" ] || PT_SECRET="$(gen)"
# Synthesis provider: pass AI_API_KEY to (re)enable Claude. Without it, keep
# whatever the app already has so a plain redeploy never downgrades to mock.
if [ -n "${AI_API_KEY:-}" ]; then PROVIDER="anthropic"
else PROVIDER="$(existing SYNTHESIS_PROVIDER)"; [ -n "$PROVIDER" ] || PROVIDER="mock"; fi

echo "==> app settings (synthesis provider: $PROVIDER)"
az webapp config appsettings set -g "$RG" -n "$APP" -o none --settings \
  NODE_ENV=production \
  SCM_DO_BUILD_DURING_DEPLOYMENT=true \
  WEBSITES_ENABLE_APP_SERVICE_STORAGE=true \
  PUBLIC_BASE_URL="$HOST" \
  CORS_ORIGIN="$HOST" \
  JWT_SECRET="$JWT_SECRET" \
  PARTICIPANT_TOKEN_SECRET="$PT_SECRET" \
  STORAGE_ENGINE=json \
  DATA_DIR=/home/data \
  SYNTHESIS_PROVIDER="$PROVIDER" \
  ${AI_API_KEY:+AI_API_KEY="$AI_API_KEY"} \
  AI_EFFORT="${AI_EFFORT:-low}" \
  SYNTHESIS_BATCH_SIZE="${SYNTHESIS_BATCH_SIZE:-5}" \
  SYNTHESIS_BATCH_INTERVAL_MS="${SYNTHESIS_BATCH_INTERVAL_MS:-8000}"

echo "==> websockets on, startup command, always-on"
az webapp config set -g "$RG" -n "$APP" -o none \
  --web-sockets-enabled true \
  --always-on true \
  --startup-file "npm start"

echo "==> zip deploy (working tree, minus node_modules and local data)"
ZIP="$(mktemp -d)/app.zip"
zip -qr "$ZIP" . -x 'node_modules/*' '*/node_modules/*' '.git/*' 'backend/data/*' 'backend/.env' '.DS_Store' '*/.DS_Store'
az webapp deploy -g "$RG" -n "$APP" --src-path "$ZIP" --type zip -o none
rm -f "$ZIP"

echo "==> pointing manifest at $HOST"
scripts/set-host.sh "$HOST"

echo
echo "Deployed. Health check:"
curl -s "$HOST/api/health" || true
echo
echo "Dashboard:  $HOST/dashboard/"
echo "Add-in:     powerpoint-addin/manifest.xml now points at $HOST (sideload it)"
