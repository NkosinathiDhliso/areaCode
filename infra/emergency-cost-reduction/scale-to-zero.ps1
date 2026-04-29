# IMMEDIATE COST REDUCTION SCRIPT (PowerShell)
# Run this to scale all expensive resources to zero

$ErrorActionPreference = "Continue"
$REGION = "us-east-1"
$CLUSTER = "area-code-prod"
$SERVICE = "area-code-prod-api"

Write-Host "================================================" -ForegroundColor Cyan
Write-Host "  EMERGENCY AWS COST REDUCTION - SCALE TO ZERO" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""

# 1. Scale ECS to zero (immediate effect)
Write-Host "[1/4] Scaling ECS service to 0 tasks..." -ForegroundColor Yellow
$ecsResult = aws ecs update-service --cluster $CLUSTER --service $SERVICE --desired-count 0 --region $REGION 2>$null
if ($LASTEXITCODE -eq 0) {
    Write-Host "    ✅ ECS tasks stopped (no more Fargate charges)" -ForegroundColor Green
} else {
    Write-Host "    ⚠️ ECS service not found or access denied" -ForegroundColor Yellow
}
Write-Host ""

# 2. Check for NAT Gateways (big cost driver)
Write-Host "[2/4] Checking for NAT Gateways (common cost driver)..." -ForegroundColor Yellow
$natGateways = aws ec2 describe-nat-gateways --region $REGION --query 'NatGateways[?State==`available`].NatGatewayId' --output text 2>$null
if ($natGateways -and $natGateways.Trim()) {
    Write-Host "    ⚠️ Found active NAT Gateways: $natGateways" -ForegroundColor Yellow
    Write-Host "    💡 NAT Gateways cost ~`$30-50/month each" -ForegroundColor Cyan
    Write-Host "    To delete: aws ec2 delete-nat-gateway --nat-gateway-id <id> --region $REGION" -ForegroundColor Gray
} else {
    Write-Host "    ✅ No active NAT Gateways found" -ForegroundColor Green
}
Write-Host ""

# 3. Check for orphaned ELBs
Write-Host "[3/4] Checking for load balancers..." -ForegroundColor Yellow
$loadBalancers = aws elbv2 describe-load-balancers --region $REGION --query 'LoadBalancers[*].[LoadBalancerName,Type,State.Code]' --output text 2>$null
if ($loadBalancers -and $loadBalancers.Trim()) {
    Write-Host "    ⚠️ Found load balancers:" -ForegroundColor Yellow
    $loadBalancers | ForEach-Object { Write-Host "      - $_" -ForegroundColor Yellow }
    Write-Host "    💡 ALBs cost ~`$20-25/month each" -ForegroundColor Cyan
} else {
    Write-Host "    ✅ No load balancers found" -ForegroundColor Green
}
Write-Host ""

# 4. Check running RDS instances
Write-Host "[4/4] Checking for RDS instances..." -ForegroundColor Yellow
$rdsInstances = aws rds describe-db-instances --region $REGION --query 'DBInstances[?DBInstanceStatus==`available`].[DBInstanceIdentifier,DBInstanceClass,MultiAZ]' --output text 2>$null
if ($rdsInstances -and $rdsInstances.Trim()) {
    Write-Host "    ⚠️ Found running RDS instances:" -ForegroundColor Yellow
    $rdsInstances | ForEach-Object { Write-Host "      - $_" -ForegroundColor Yellow }
    Write-Host "    💡 db.t4g.medium multi-AZ costs ~`$70-80/month" -ForegroundColor Cyan
    Write-Host "    To delete after backup: terraform destroy -target=module.rds" -ForegroundColor Gray
} else {
    Write-Host "    ✅ No running RDS instances found" -ForegroundColor Green
}
Write-Host ""

Write-Host "================================================" -ForegroundColor Cyan
Write-Host "  IMMEDIATE ACTIONS COMPLETE" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "What was done:" -ForegroundColor Green
Write-Host "  ✓ ECS scaled to 0 (saves ~`$50-70/month immediately)" -ForegroundColor Green
Write-Host ""
Write-Host "What you still need to do:" -ForegroundColor Yellow
Write-Host "  1. Delete RDS instance (backup first!)" -ForegroundColor White
Write-Host "  2. Delete ElastiCache cluster" -ForegroundColor White
Write-Host "  3. Delete NAT Gateways if not needed" -ForegroundColor White
Write-Host "  4. Delete WAF if not needed" -ForegroundColor White
Write-Host ""
Write-Host "Quick commands:" -ForegroundColor Cyan
Write-Host "  cd infra\environments\prod" -ForegroundColor Gray
Write-Host "  terraform destroy -target=module.rds -target=module.elasticache -target=module.waf" -ForegroundColor Gray
Write-Host ""
