#!/usr/bin/env bash
# Serverless Backend Deployment
# Deploys monolith API Lambda, WebSocket Lambda, and worker Lambdas
set -euo pipefail

REGION="${1:-us-east-1}"
ENVIRONMENT="${2:-prod}"
SKIP_BUILD="${SKIP_BUILD:-false}"
SKIP_TERRAFORM="${SKIP_TERRAFORM:-false}"

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
INFRA_DIR="$ROOT_DIR/infra/environments/$ENVIRONMENT"

echo "=========================================="
echo "  Area Code — Serverless Deployment"
echo "  Environment: $ENVIRONMENT"
echo "  Region: $REGION"
echo "=========================================="

# ── Step 1: Build Lambda bundles ──────────────────────────────────────────────
if [ "$SKIP_BUILD" != "true" ]; then
    echo ""
    echo "[1/5] Building Lambda bundles..."
    cd "$ROOT_DIR"
    pnpm --filter backend build:lambda
    echo "  ✓ Build complete"
else
    echo ""
    echo "[1/5] Skipping build"
fi

# ── Step 2: Terraform apply ──────────────────────────────────────────────────
if [ "$SKIP_TERRAFORM" != "true" ]; then
    echo ""
    echo "[2/5] Running Terraform apply..."
    cd "$INFRA_DIR"
    terraform init -input=false
    # Release commit is baked into the Lambda bundle at build:lambda time
    # (esbuild define -> GET /health `commit`); no git_sha var needed.
    terraform apply -auto-approve

    API_ENDPOINT=$(terraform output -raw api_endpoint)
    WS_ENDPOINT=$(terraform output -raw websocket_api_endpoint 2>/dev/null || echo "")
    echo "  ✓ Infrastructure deployed"
else
    echo ""
    echo "[2/5] Skipping Terraform"
    API_ENDPOINT=""
    WS_ENDPOINT=""
fi

# ── Step 3: Package and deploy monolith API Lambda ────────────────────────────
echo ""
echo "[3/5] Deploying monolith API Lambda..."

cd "$BACKEND_DIR/dist/lambda"
zip -j "$BACKEND_DIR/dist/api-lambda.zip" index.mjs

FUNC_NAME="area-code-$ENVIRONMENT-api"
echo "  Deploying: $FUNC_NAME"
aws lambda update-function-code \
    --function-name "$FUNC_NAME" \
    --zip-file "fileb://$BACKEND_DIR/dist/api-lambda.zip" \
    --region "$REGION" \
    --publish --no-cli-pager || echo "  ⚠ Failed (function may not exist yet)"

# ── Step 4: Package and deploy WebSocket Lambda ──────────────────────────────
echo ""
echo "[4/5] Deploying WebSocket Lambda..."

cd "$BACKEND_DIR/dist/websocket"
zip -j "$BACKEND_DIR/dist/websocket-lambda.zip" index.mjs

WS_FUNC_NAME="area-code-$ENVIRONMENT-websocket"
echo "  Deploying: $WS_FUNC_NAME"
if aws lambda update-function-code \
    --function-name "$WS_FUNC_NAME" \
    --zip-file "fileb://$BACKEND_DIR/dist/websocket-lambda.zip" \
    --region "$REGION" \
    --publish --no-cli-pager 2>/dev/null; then

    echo "  ✓ $WS_FUNC_NAME deployed"

    # Set WEBSOCKET_ENDPOINT env var (resolves circular dep from Terraform)
    if [ -n "$WS_ENDPOINT" ]; then
        MGMT_ENDPOINT="${WS_ENDPOINT/wss:\/\//https:\/\/}"
        echo "  Setting WEBSOCKET_ENDPOINT=$MGMT_ENDPOINT"
        aws lambda update-function-configuration \
            --function-name "$WS_FUNC_NAME" \
            --environment "Variables={AREA_CODE_ENV=$ENVIRONMENT,CONNECTIONS_TABLE=area-code-$ENVIRONMENT-websocket-connections,WEBSOCKET_ENDPOINT=$MGMT_ENDPOINT}" \
            --region "$REGION" --no-cli-pager
    fi
else
    echo "  ⚠ Skipped (function may not exist yet)"
fi

# ── Step 5: Deploy worker Lambdas ────────────────────────────────────────────
echo ""
echo "[5/5] Deploying worker Lambdas..."

for worker_dir in "$BACKEND_DIR/dist/workers"/*/; do
    worker_name=$(basename "$worker_dir")
    func_name="area-code-$ENVIRONMENT-$worker_name"
    zip_path="$BACKEND_DIR/dist/workers/$worker_name.zip"

    cd "$worker_dir"
    zip -j "$zip_path" index.mjs

    echo "  Deploying: $func_name"
    aws lambda update-function-code \
        --function-name "$func_name" \
        --zip-file "fileb://$zip_path" \
        --region "$REGION" \
        --publish --no-cli-pager 2>/dev/null || echo "    ⚠ Skipped (function may not exist)"
done

# ── Summary ──────────────────────────────────────────────────────────────────
echo ""
echo "=========================================="
echo "  Deployment Complete!"
echo "=========================================="
echo ""
[ -n "$API_ENDPOINT" ] && echo "  HTTP API:      $API_ENDPOINT"
[ -n "$WS_ENDPOINT" ]  && echo "  WebSocket API: $WS_ENDPOINT"
echo ""
echo "  Next steps:"
echo "  1. Update Amplify env vars with the API/WebSocket endpoints"
echo "  2. Trigger Amplify rebuilds for frontend apps"
echo ""
