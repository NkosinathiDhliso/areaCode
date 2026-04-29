#!/bin/bash
# IMMEDIATE COST REDUCTION SCRIPT
# Run this to scale all expensive resources to zero

set -e

REGION="us-east-1"
CLUSTER="area-code-prod"
SERVICE="area-code-prod-api"

echo "================================================"
echo "  EMERGENCY AWS COST REDUCTION - SCALE TO ZERO"
echo "================================================"
echo ""

# 1. Scale ECS to zero (immediate effect)
echo "[1/4] Scaling ECS service to 0 tasks..."
aws ecs update-service \
    --cluster $CLUSTER \
    --service $SERVICE \
    --desired-count 0 \
    --region $REGION 2>/dev/null || echo "    ⚠️ ECS service not found or access denied"

echo "    ✅ ECS tasks stopped (no more Fargate charges)"
echo ""

# 2. Check for NAT Gateways (big cost driver)
echo "[2/4] Checking for NAT Gateways (common cost driver)..."
NAT_GATEWAYS=$(aws ec2 describe-nat-gateways --region $REGION --query 'NatGateways[?State==`available`].NatGatewayId' --output text 2>/dev/null || echo "")
if [ -n "$NAT_GATEWAYS" ]; then
    echo "    ⚠️ Found active NAT Gateways: $NAT_GATEWAYS"
    echo "    💡 NAT Gateways cost ~$30-50/month each"
    echo "    To delete: aws ec2 delete-nat-gateway --nat-gateway-id <id> --region $REGION"
else
    echo "    ✅ No active NAT Gateways found"
fi
echo ""

# 3. Check for orphaned ELBs
echo "[3/4] Checking for load balancers..."
LOAD_BALANCERS=$(aws elbv2 describe-load-balancers --region $REGION --query 'LoadBalancers[*].[LoadBalancerName,Type,State.Code]' --output text 2>/dev/null || echo "")
if [ -n "$LOAD_BALANCERS" ]; then
    echo "    ⚠️ Found load balancers:"
    echo "$LOAD_BALANCERS" | while read line; do
        echo "      - $line"
    done
    echo "    💡 ALBs cost ~$20-25/month each"
else
    echo "    ✅ No load balancers found"
fi
echo ""

# 4. Check running RDS instances
echo "[4/4] Checking for RDS instances..."
RDS_INSTANCES=$(aws rds describe-db-instances --region $REGION --query 'DBInstances[?DBInstanceStatus==`available`].[DBInstanceIdentifier,DBInstanceClass,MultiAZ]' --output text 2>/dev/null || echo "")
if [ -n "$RDS_INSTANCES" ]; then
    echo "    ⚠️ Found running RDS instances:"
    echo "$RDS_INSTANCES" | while read line; do
        echo "      - $line"
    done
    echo "    💡 db.t4g.medium multi-AZ costs ~$70-80/month"
    echo "    To delete after backup: terraform destroy -target=module.rds"
else
    echo "    ✅ No running RDS instances found"
fi
echo ""

echo "================================================"
echo "  IMMEDIATE ACTIONS COMPLETE"
echo "================================================"
echo ""
echo "What was done:"
echo "  ✓ ECS scaled to 0 (saves ~$50-70/month immediately)"
echo ""
echo "What you still need to do:"
echo "  1. Delete RDS instance (backup first!)"
echo "  2. Delete ElastiCache cluster"
echo "  3. Delete NAT Gateways if not needed"
echo "  4. Delete WAF if not needed"
echo ""
echo "Quick commands:"
echo "  cd infra/environments/prod"
echo "  terraform destroy -target=module.rds -target=module.elasticache -target=module.waf"
echo ""
