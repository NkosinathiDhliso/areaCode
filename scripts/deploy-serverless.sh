#!/bin/bash
# Deploy serverless backend to AWS Lambda

set -e

echo "=========================================="
echo "  Serverless Backend Deployment"
echo "=========================================="

# Configuration
REGION="us-east-1"
ENV="prod"
LAMBDA_FUNCTIONS=(
  "check-in"
  "node-detail"
  "rewards-near-me"
  "reward-evaluator"
  "pulse-decay"
  "leaderboard-reset"
  "partition-manager"
  "cleanup"
  "yoco-webhook"
)

cd "$(dirname "$0")/../backend"

echo ""
echo "[1/4] Installing dependencies..."
npm install

echo ""
echo "[2/4] Building TypeScript..."
npm run build

echo ""
echo "[3/4] Packaging Lambda functions..."

# Create dist directory
mkdir -p dist

# Build each Lambda function
for func in "${LAMBDA_FUNCTIONS[@]}"; do
  echo "  Packaging: $func"
  
  # Create function directory
  mkdir -p "dist/$func"
  
  # Copy built files
  cp -r build/* "dist/$func/"
  
  # Create package.json for the function
  cat > "dist/$func/package.json" <<EOF
{
  "name": "$func",
  "type": "module",
  "main": "src/lambdas/$func.js"
}
EOF
  
  # Install production dependencies
  cd "dist/$func"
  npm install --production
  cd ../..
  
  # Create zip
  cd dist
  zip -r "$func.zip" "$func/" -x "*.map" "*.d.ts"
  cd ..
done

echo ""
echo "[4/4] Deploying to AWS Lambda..."

for func in "${LAMBDA_FUNCTIONS[@]}"; do
  echo "  Deploying: $func"
  
  aws lambda update-function-code \
    --function-name "area-code-$ENV-$func" \
    --zip-file "fileb://dist/$func.zip" \
    --region "$REGION" \
    --publish
    
  # Update environment variables
  aws lambda update-function-configuration \
    --function-name "area-code-$ENV-$func" \
    --environment "Variables={
      AREA_CODE_ENV=$ENV,
      USERS_TABLE=area-code-$ENV-users,
      NODES_TABLE=area-code-$ENV-nodes,
      CHECKINS_TABLE=area-code-$ENV-checkins,
      REWARDS_TABLE=area-code-$ENV-rewards,
      BUSINESSES_TABLE=area-code-$ENV-businesses,
      APP_DATA_TABLE=area-code-$ENV-app-data,
      AWS_REGION=$REGION
    }" \
    --region "$REGION"
done

echo ""
echo "=========================================="
echo "  Deployment Complete!"
echo "=========================================="
echo ""
echo "API Endpoint: https://iyj02gvt12.execute-api.us-east-1.amazonaws.com"
echo "DynamoDB Tables:"
echo "  - area-code-$ENV-users"
echo "  - area-code-$ENV-nodes"
echo "  - area-code-$ENV-checkins"
echo "  - area-code-$ENV-rewards"
echo "  - area-code-$ENV-businesses"
echo "  - area-code-$ENV-app-data"
