#!/usr/bin/env bash
set -euo pipefail

# ── deploy-secrets.sh ────────────────────────────────────────────────────────
# Reads .env and pushes mapped secrets to AWS Secrets Manager.
# Usage: ./scripts/deploy-secrets.sh --env dev|prod
# ─────────────────────────────────────────────────────────────────────────────

ENV=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env)
      ENV="$2"
      shift 2
      ;;
    *)
      echo "Unknown option: $1"
      echo "Usage: $0 --env dev|prod"
      exit 1
      ;;
  esac
done

if [[ -z "$ENV" ]]; then
  echo "Error: --env flag is required (dev|prod)"
  exit 1
fi

if [[ "$ENV" != "dev" && "$ENV" != "prod" ]]; then
  echo "Error: --env must be 'dev' or 'prod'"
  exit 1
fi

ENV_FILE=".env"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "Error: $ENV_FILE not found"
  exit 1
fi

# shellcheck disable=SC1090
source "$ENV_FILE"

# ── Helper: upsert a secret in AWS Secrets Manager ──────────────────────────
upsert_secret() {
  local secret_name="$1"
  local secret_value="$2"

  if aws secretsmanager describe-secret --secret-id "$secret_name" >/dev/null 2>&1; then
    echo "Updating: $secret_name"
    aws secretsmanager put-secret-value \
      --secret-id "$secret_name" \
      --secret-string "$secret_value"
  else
    echo "Creating: $secret_name"
    aws secretsmanager create-secret \
      --name "$secret_name" \
      --secret-string "$secret_value"
  fi
}

# ── Select Yoco keys based on environment ────────────────────────────────────
if [[ "$ENV" == "prod" ]]; then
  YOCO_SECRET="${YOCO_PROD_SECRET_KEY:-}"
  YOCO_PUBLIC="${YOCO_PROD_PUBLIC_KEY:-}"
else
  YOCO_SECRET="${YOCO_DEV_SECRET_KEY:-}"
  YOCO_PUBLIC="${YOCO_DEV_PUBLIC_KEY:-}"
fi

# ── Push secrets ─────────────────────────────────────────────────────────────
upsert_secret "area-code/${ENV}/yoco-secret-key"       "$YOCO_SECRET"
upsert_secret "area-code/${ENV}/yoco-public-key"       "$YOCO_PUBLIC"
upsert_secret "area-code/${ENV}/mapbox-token"          "${VITE_MAPBOX_TOKEN:-}"
upsert_secret "area-code/${ENV}/db-url"                "${AREA_CODE_DB_URL:-}"
upsert_secret "area-code/${ENV}/db-read-url"           "${AREA_CODE_DB_READ_URL:-}"
upsert_secret "area-code/${ENV}/redis-url"             "${AREA_CODE_REDIS_URL:-}"
upsert_secret "area-code/${ENV}/qr-hmac-secret"        "${AREA_CODE_QR_HMAC_SECRET:-}"
upsert_secret "area-code/${ENV}/fingerprint-pro-key"   "${AREA_CODE_FINGERPRINT_PRO_KEY:-}"
upsert_secret "area-code/${ENV}/cipc-api-key"          "${AREA_CODE_CIPC_API_KEY:-}"
upsert_secret "area-code/${ENV}/vapid-private-key"     "${AREA_CODE_VAPID_PRIVATE_KEY:-}"
upsert_secret "area-code/${ENV}/sqs-reward-queue-url"  "${AREA_CODE_SQS_REWARD_QUEUE_URL:-}"
upsert_secret "area-code/${ENV}/sqs-push-queue-url"    "${AREA_CODE_SQS_PUSH_QUEUE_URL:-}"

echo ""
echo "All secrets deployed to area-code/${ENV}/*"
