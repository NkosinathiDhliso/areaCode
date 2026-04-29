# Serverless Backend Deployment for Windows PowerShell
param(
    [string]$Region = "us-east-1",
    [string]$Environment = "prod"
)

$ErrorActionPreference = "Stop"

$LambdaFunctions = @(
    "check-in",
    "node-detail", 
    "rewards-near-me",
    "reward-evaluator",
    "pulse-decay",
    "leaderboard-reset",
    "partition-manager",
    "cleanup",
    "yoco-webhook"
)

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "  Serverless Backend Deployment" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

$BackendDir = Join-Path $PSScriptRoot "..\backend"
Set-Location $BackendDir

Write-Host ""
Write-Host "[1/4] Installing dependencies..." -ForegroundColor Yellow
npm install

Write-Host ""
Write-Host "[2/4] Building TypeScript..." -ForegroundColor Yellow
npm run build

Write-Host ""
Write-Host "[3/4] Packaging Lambda functions..." -ForegroundColor Yellow

# Create dist directory
$DistDir = "dist"
New-Item -ItemType Directory -Force -Path $DistDir | Out-Null

# Build each Lambda function
foreach ($func in $LambdaFunctions) {
    Write-Host "  Packaging: $func" -ForegroundColor Gray
    
    $FuncDir = Join-Path $DistDir $func
    New-Item -ItemType Directory -Force -Path $FuncDir | Out-Null
    
    # Copy built files
    Copy-Item -Path "build\*" -Destination $FuncDir -Recurse -Force
    
    # Create package.json
    @"
{
  "name": "$func",
  "type": "module",
  "main": "src/lambdas/$func.js"
}
"@ | Set-Content (Join-Path $FuncDir "package.json")
    
    # Install production dependencies
    Push-Location $FuncDir
    npm install --production
    Pop-Location
    
    # Create zip
    Push-Location $DistDir
    Compress-Archive -Path $func -DestinationPath "$func.zip" -Force
    Pop-Location
}

Write-Host ""
Write-Host "[4/4] Deploying to AWS Lambda..." -ForegroundColor Yellow

foreach ($func in $LambdaFunctions) {
    Write-Host "  Deploying: $func" -ForegroundColor Gray
    
    $FunctionName = "area-code-$Environment-$func"
    $ZipPath = Join-Path $DistDir "$func.zip"
    
    # Update function code
    aws lambda update-function-code `
        --function-name $FunctionName `
        --zip-file "fileb://$ZipPath" `
        --region $Region `
        --publish
    
    # Update environment variables
    $EnvVars = "Variables={AREA_CODE_ENV=$Environment,USERS_TABLE=area-code-$Environment-users,NODES_TABLE=area-code-$Environment-nodes,CHECKINS_TABLE=area-code-$Environment-checkins,REWARDS_TABLE=area-code-$Environment-rewards,BUSINESSES_TABLE=area-code-$Environment-businesses,APP_DATA_TABLE=area-code-$Environment-app-data,AWS_REGION=$Region}"
    
    aws lambda update-function-configuration `
        --function-name $FunctionName `
        --environment $EnvVars `
        --region $Region
}

Write-Host ""
Write-Host "==========================================" -ForegroundColor Green
Write-Host "  Deployment Complete!" -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Green
Write-Host ""
Write-Host "API Endpoint: https://iyj02gvt12.execute-api.us-east-1.amazonaws.com" -ForegroundColor Cyan
Write-Host "DynamoDB Tables:" -ForegroundColor Cyan
Write-Host "  - area-code-$Environment-users" -ForegroundColor Gray
Write-Host "  - area-code-$Environment-nodes" -ForegroundColor Gray
Write-Host "  - area-code-$Environment-checkins" -ForegroundColor Gray
Write-Host "  - area-code-$Environment-rewards" -ForegroundColor Gray
Write-Host "  - area-code-$Environment-businesses" -ForegroundColor Gray
Write-Host "  - area-code-$Environment-app-data" -ForegroundColor Gray
