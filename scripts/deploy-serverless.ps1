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
$InfraDir = [System.IO.Path]::Combine($RootDir, "infra", "environments", $Environment)

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "  Area Code - Serverless Deployment" -ForegroundColor Cyan
Write-Host "  Environment: $Environment" -ForegroundColor Cyan
Write-Host "  Region: $Region" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

# ── Step 1: Build Lambda bundles ──────────────────────────────────────────────
if (-not $SkipBuild -and -not $TerraformOnly) {
    Write-Host ""
    Write-Host "[1/5] Building Lambda bundles..." -ForegroundColor Yellow
    Push-Location $RootDir
    pnpm --filter backend build:lambda
    if ($LASTEXITCODE -ne 0) { Pop-Location; throw "Build failed" }
    Pop-Location
    Write-Host "  [OK] Build complete" -ForegroundColor Green
} else {
    Write-Host ""
    Write-Host "[1/5] Skipping build" -ForegroundColor DarkGray
}

# ── Step 2: Terraform apply ──────────────────────────────────────────────────
$ApiEndpoint = ""
$WsEndpoint = ""
if (-not $SkipTerraform) {
    Write-Host ""
    Write-Host "[2/5] Running Terraform apply..." -ForegroundColor Yellow

    # Resolve the short git SHA in PowerShell (the bash `cmd || echo` idiom is
    # not valid PowerShell, so compute it here and pass it as a plain value).
    $GitSha = (git rev-parse --short HEAD 2>$null)
    if (-not $GitSha) { $GitSha = "unknown" }

    Push-Location $InfraDir
    terraform init -input=false
    if ($LASTEXITCODE -ne 0) { Pop-Location; throw "Terraform init failed" }
    terraform apply -auto-approve -var="git_sha=$GitSha"
    if ($LASTEXITCODE -ne 0) { Pop-Location; throw "Terraform apply failed" }

    # Capture outputs
    $ApiEndpoint = terraform output -raw api_endpoint
    $WsEndpoint = terraform output -raw websocket_api_endpoint 2>$null
    Pop-Location
    Write-Host "  [OK] Infrastructure deployed" -ForegroundColor Green
} else {
    Write-Host ""
    Write-Host "[2/5] Skipping Terraform" -ForegroundColor DarkGray
}

if ($TerraformOnly) {
    Write-Host ""
    Write-Host "Terraform-only mode - skipping Lambda code deployment" -ForegroundColor DarkGray
    exit 0
}

# ── Step 3: Package and deploy monolith API Lambda ────────────────────────────
Write-Host ""
Write-Host "[3/5] Deploying monolith API Lambda..." -ForegroundColor Yellow

$ApiDistDir = [System.IO.Path]::Combine($BackendDir, "dist", "lambda")
$ApiZip = [System.IO.Path]::Combine($BackendDir, "dist", "api-lambda.zip")

# Create zip from the built bundle (index.mjs at the archive root)
Compress-Archive -Path (Join-Path $ApiDistDir "index.mjs") -DestinationPath $ApiZip -Force

$ApiFunctionName = "area-code-$Environment-api"
Write-Host "  Deploying: $ApiFunctionName" -ForegroundColor Gray
aws lambda update-function-code `
    --function-name $ApiFunctionName `
    --zip-file "fileb://$ApiZip" `
    --region $Region `
    --publish --no-cli-pager
if ($LASTEXITCODE -ne 0) { Write-Host "  [WARN] Failed to deploy $ApiFunctionName (may not exist yet)" -ForegroundColor DarkYellow }
else {
    aws lambda wait function-updated --function-name $ApiFunctionName --region $Region
    Write-Host "  [OK] $ApiFunctionName deployed" -ForegroundColor Green
}

# ── Step 4: Package and deploy WebSocket Lambda ──────────────────────────────
Write-Host ""
Write-Host "[4/5] Deploying WebSocket Lambda..." -ForegroundColor Yellow

$WsDistDir = [System.IO.Path]::Combine($BackendDir, "dist", "websocket")
$WsZip = [System.IO.Path]::Combine($BackendDir, "dist", "websocket-lambda.zip")

Compress-Archive -Path (Join-Path $WsDistDir "index.mjs") -DestinationPath $WsZip -Force

$WsFunctionName = "area-code-$Environment-websocket"
Write-Host "  Deploying: $WsFunctionName" -ForegroundColor Gray
aws lambda update-function-code `
    --function-name $WsFunctionName `
    --zip-file "fileb://$WsZip" `
    --region $Region `
    --publish --no-cli-pager
if ($LASTEXITCODE -ne 0) { Write-Host "  [WARN] Failed to deploy $WsFunctionName (may not exist yet)" -ForegroundColor DarkYellow }
else {
    aws lambda wait function-updated --function-name $WsFunctionName --region $Region
    Write-Host "  [OK] $WsFunctionName deployed" -ForegroundColor Green

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

$WorkersDir = [System.IO.Path]::Combine($BackendDir, "dist", "workers")
$Workers = Get-ChildItem -Path $WorkersDir -Directory

foreach ($worker in $Workers) {
    $WorkerName = $worker.Name
    $FunctionName = "area-code-$Environment-$WorkerName"
    $WorkerZip = Join-Path $WorkersDir "$WorkerName.zip"

    Compress-Archive -Path (Join-Path $worker.FullName "index.mjs") -DestinationPath $WorkerZip -Force

    Write-Host "  Deploying: $FunctionName" -ForegroundColor Gray
    # Native-command stderr under Windows PowerShell 5.1 becomes a terminating
    # error when $ErrorActionPreference is 'Stop', so soften it locally and rely
    # on $LASTEXITCODE for the real result (warn-and-continue is intentional:
    # a worker that is still being created by Terraform already has the new
    # code and a transient ResourceConflict here is non-fatal).
    $prevEAP = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    aws lambda update-function-code `
        --function-name $FunctionName `
        --zip-file "fileb://$WorkerZip" `
        --region $Region `
        --publish --no-cli-pager | Out-Null
    $code = $LASTEXITCODE
    $ErrorActionPreference = $prevEAP
    if ($code -ne 0) { Write-Host "    [WARN] Skipped (function still initialising or not in Terraform)" -ForegroundColor DarkYellow }
    else { Write-Host "    [OK] deployed" -ForegroundColor Green }
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
