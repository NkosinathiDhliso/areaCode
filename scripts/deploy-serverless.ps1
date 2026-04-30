# Serverless Backend Deployment for Windows PowerShell
# Deploys monolith API Lambda, WebSocket Lambda, and worker Lambdas
param(
    [string]$Region = "us-east-1",
    [string]$Environment = "prod",
    [switch]$SkipBuild,
    [switch]$SkipTerraform,
    [switch]$TerraformOnly
)

$ErrorActionPreference = "Stop"
$RootDir = Split-Path $PSScriptRoot -Parent
$BackendDir = Join-Path $RootDir "backend"
$InfraDir = Join-Path $RootDir "infra" "environments" $Environment

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "  Area Code — Serverless Deployment" -ForegroundColor Cyan
Write-Host "  Environment: $Environment" -ForegroundColor Cyan
Write-Host "  Region: $Region" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

# ── Step 1: Build Lambda bundles ──────────────────────────────────────────────
if (-not $SkipBuild -and -not $TerraformOnly) {
    Write-Host ""
    Write-Host "[1/5] Building Lambda bundles..." -ForegroundColor Yellow
    Push-Location $RootDir
    pnpm --filter backend build:lambda
    if ($LASTEXITCODE -ne 0) { throw "Build failed" }
    Pop-Location
    Write-Host "  ✓ Build complete" -ForegroundColor Green
} else {
    Write-Host ""
    Write-Host "[1/5] Skipping build" -ForegroundColor DarkGray
}

# ── Step 2: Terraform apply ──────────────────────────────────────────────────
if (-not $SkipTerraform) {
    Write-Host ""
    Write-Host "[2/5] Running Terraform apply..." -ForegroundColor Yellow
    Push-Location $InfraDir
    terraform init -input=false
    terraform apply -auto-approve -var="git_sha=$(git rev-parse --short HEAD 2>$null || echo 'unknown')"
    if ($LASTEXITCODE -ne 0) { throw "Terraform apply failed" }

    # Capture outputs
    $ApiEndpoint = terraform output -raw api_endpoint
    $WsEndpoint = terraform output -raw websocket_api_endpoint 2>$null
    Pop-Location
    Write-Host "  ✓ Infrastructure deployed" -ForegroundColor Green
} else {
    Write-Host ""
    Write-Host "[2/5] Skipping Terraform" -ForegroundColor DarkGray
}

if ($TerraformOnly) {
    Write-Host ""
    Write-Host "Terraform-only mode — skipping Lambda code deployment" -ForegroundColor DarkGray
    exit 0
}

# ── Step 3: Package and deploy monolith API Lambda ────────────────────────────
Write-Host ""
Write-Host "[3/5] Deploying monolith API Lambda..." -ForegroundColor Yellow

$ApiDistDir = Join-Path $BackendDir "dist" "lambda"
$ApiZip = Join-Path $BackendDir "dist" "api-lambda.zip"

# Create zip from the built bundle
Push-Location $ApiDistDir
Compress-Archive -Path "index.mjs" -DestinationPath $ApiZip -Force
Pop-Location

$ApiFunctionName = "area-code-$Environment-api"
Write-Host "  Deploying: $ApiFunctionName" -ForegroundColor Gray
aws lambda update-function-code `
    --function-name $ApiFunctionName `
    --zip-file "fileb://$ApiZip" `
    --region $Region `
    --publish --no-cli-pager
if ($LASTEXITCODE -ne 0) { Write-Host "  ⚠ Failed to deploy $ApiFunctionName (may not exist yet)" -ForegroundColor DarkYellow }
else { Write-Host "  ✓ $ApiFunctionName deployed" -ForegroundColor Green }

# ── Step 4: Package and deploy WebSocket Lambda ──────────────────────────────
Write-Host ""
Write-Host "[4/5] Deploying WebSocket Lambda..." -ForegroundColor Yellow

$WsDistDir = Join-Path $BackendDir "dist" "websocket"
$WsZip = Join-Path $BackendDir "dist" "websocket-lambda.zip"

Push-Location $WsDistDir
Compress-Archive -Path "index.mjs" -DestinationPath $WsZip -Force
Pop-Location

$WsFunctionName = "area-code-$Environment-websocket"
Write-Host "  Deploying: $WsFunctionName" -ForegroundColor Gray
aws lambda update-function-code `
    --function-name $WsFunctionName `
    --zip-file "fileb://$WsZip" `
    --region $Region `
    --publish --no-cli-pager
if ($LASTEXITCODE -ne 0) { Write-Host "  ⚠ Failed to deploy $WsFunctionName (may not exist yet)" -ForegroundColor DarkYellow }
else {
    Write-Host "  ✓ $WsFunctionName deployed" -ForegroundColor Green

    # Set WEBSOCKET_ENDPOINT env var (resolves circular dep from Terraform)
    if ($WsEndpoint) {
        # Convert wss:// endpoint to https:// for API Gateway Management API
        $ManagementEndpoint = $WsEndpoint -replace "^wss://", "https://"
        Write-Host "  Setting WEBSOCKET_ENDPOINT=$ManagementEndpoint" -ForegroundColor Gray
        aws lambda update-function-configuration `
            --function-name $WsFunctionName `
            --environment "Variables={AREA_CODE_ENV=$Environment,CONNECTIONS_TABLE=area-code-$Environment-websocket-connections,WEBSOCKET_ENDPOINT=$ManagementEndpoint}" `
            --region $Region --no-cli-pager
    }
}

# ── Step 5: Deploy worker Lambdas ────────────────────────────────────────────
Write-Host ""
Write-Host "[5/5] Deploying worker Lambdas..." -ForegroundColor Yellow

$WorkersDir = Join-Path $BackendDir "dist" "workers"
$Workers = Get-ChildItem -Path $WorkersDir -Directory

foreach ($worker in $Workers) {
    $WorkerName = $worker.Name
    $FunctionName = "area-code-$Environment-$WorkerName"
    $WorkerZip = Join-Path $WorkersDir "$WorkerName.zip"

    Push-Location $worker.FullName
    Compress-Archive -Path "index.mjs" -DestinationPath $WorkerZip -Force
    Pop-Location

    Write-Host "  Deploying: $FunctionName" -ForegroundColor Gray
    aws lambda update-function-code `
        --function-name $FunctionName `
        --zip-file "fileb://$WorkerZip" `
        --region $Region `
        --publish --no-cli-pager 2>$null
    if ($LASTEXITCODE -ne 0) { Write-Host "    ⚠ Skipped (function may not exist in Terraform)" -ForegroundColor DarkYellow }
    else { Write-Host "    ✓ deployed" -ForegroundColor Green }
}

# ── Summary ──────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "==========================================" -ForegroundColor Green
Write-Host "  Deployment Complete!" -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Green
Write-Host ""
if ($ApiEndpoint) { Write-Host "  HTTP API:      $ApiEndpoint" -ForegroundColor Cyan }
if ($WsEndpoint)  { Write-Host "  WebSocket API: $WsEndpoint" -ForegroundColor Cyan }
Write-Host ""
Write-Host "  Next steps:" -ForegroundColor White
Write-Host "  1. Update Amplify env vars with the API/WebSocket endpoints" -ForegroundColor Gray
Write-Host "     ./scripts/update-all-amplify-apps.ps1" -ForegroundColor Gray
Write-Host "  2. Trigger Amplify rebuilds for frontend apps" -ForegroundColor Gray
Write-Host ""
