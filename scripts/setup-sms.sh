#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Post-Terraform SMS setup for End User Messaging v2
#
# Creates resources not supported by the Terraform AWS provider (v5.x):
#   - Event destination (CloudWatch Logs) on the Configuration Set
#   - Protect Configuration for AIT/SMS pumping defense
#   - Monthly spend limit
#
# Usage:
#   ./scripts/setup-sms.sh dev     # MONITOR mode, $100 limit
#   ./scripts/setup-sms.sh prod    # FILTER mode, $500 limit
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

ENV="${1:?Usage: $0 <dev|prod>}"
REGION="us-east-1"
CONFIG_SET="area-code-${ENV}-otp"
LOG_GROUP="/area-code/${ENV}/sms-events"

echo "=== SMS setup for ${ENV} environment ==="

# ─── 1. Event Destination (delivery logs → CloudWatch) ───────────────────────
echo "Creating CloudWatch event destination on ${CONFIG_SET}..."

ROLE_ARN=$(aws iam get-role \
  --role-name "area-code-${ENV}-sms-cloudwatch" \
  --query 'Role.Arn' --output text \
  --region "${REGION}" 2>/dev/null || echo "")

if [ -z "$ROLE_ARN" ]; then
  echo "  ERROR: IAM role area-code-${ENV}-sms-cloudwatch not found. Run terraform apply first."
  exit 1
fi

LOG_GROUP_ARN=$(aws logs describe-log-groups \
  --log-group-name-prefix "${LOG_GROUP}" \
  --query "logGroups[?logGroupName=='${LOG_GROUP}'].arn" \
  --output text --region "${REGION}" 2>/dev/null || echo "")

if [ -z "$LOG_GROUP_ARN" ]; then
  echo "  ERROR: Log group ${LOG_GROUP} not found. Run terraform apply first."
  exit 1
fi

aws pinpoint-sms-voice-v2 create-event-destination \
  --configuration-set-name "${CONFIG_SET}" \
  --event-destination-name "cloudwatch-delivery-logs" \
  --matching-event-types "ALL" \
  --cloud-watch-logs-destination "IamRoleArn=${ROLE_ARN},LogGroupArn=${LOG_GROUP_ARN}" \
  --region "${REGION}" 2>/dev/null && echo "  ✓ Event destination created" \
  || echo "  ⓘ Event destination already exists (or error — check above)"

# ─── 2. Protect Configuration (AIT defense) ─────────────────────────────────
echo "Creating Protect Configuration..."

if [ "$ENV" = "prod" ]; then
  PROTECT_MODE="BLOCK"
  SPEND_LIMIT=500
else
  PROTECT_MODE="ALLOW"
  SPEND_LIMIT=100
fi

PROTECT_ID=$(aws pinpoint-sms-voice-v2 create-protect-configuration \
  --tags "Key=Environment,Value=${ENV}" "Key=Name,Value=area-code-${ENV}-otp-protect" \
  --query 'ProtectConfigurationId' --output text \
  --region "${REGION}" 2>/dev/null || echo "")

if [ -n "$PROTECT_ID" ]; then
  echo "  ✓ Protect Configuration created: ${PROTECT_ID}"

  # Add South Africa country rule
  aws pinpoint-sms-voice-v2 update-protect-configuration-country-rule-set \
    --protect-configuration-id "${PROTECT_ID}" \
    --number-capability "SMS" \
    --country-rule-set-updates "ZA={ProtectStatus=${PROTECT_MODE}}" \
    --region "${REGION}" 2>/dev/null && echo "  ✓ ZA country rule set (${PROTECT_MODE})" \
    || echo "  ⚠ Failed to set ZA country rule"

  echo ""
  echo "  To use this in your Lambda triggers, set the environment variable:"
  echo "    SMS_PROTECT_CONFIGURATION=${PROTECT_ID}"
else
  echo "  ⓘ Protect Configuration may already exist (or error — check above)"
  echo "  List existing: aws pinpoint-sms-voice-v2 describe-protect-configurations --region ${REGION}"
fi

# ─── 3. Monthly spend limit ─────────────────────────────────────────────────
echo "Setting monthly SMS spend limit to \$${SPEND_LIMIT}..."

aws pinpoint-sms-voice-v2 set-text-message-spend-limit-override \
  --monthly-limit "${SPEND_LIMIT}" \
  --region "${REGION}" 2>/dev/null && echo "  ✓ Spend limit set to \$${SPEND_LIMIT}/month" \
  || echo "  ⚠ Failed to set spend limit (may need service quota increase)"

echo ""
echo "=== Done. Next steps: ==="
echo "  1. If in SMS sandbox: request production access via AWS Support"
echo "  2. Add test numbers: aws pinpoint-sms-voice-v2 create-verified-destination-number --destination-phone-number +27XXXXXXXXX --region ${REGION}"
echo "  3. Verify with: aws pinpoint-sms-voice-v2 describe-configuration-sets --region ${REGION}"
