#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Update all 4 Area Code Amplify apps with new serverless API endpoints
.DESCRIPTION
    Updates environment variables and triggers redeployment for all frontend apps
#>

param(
    [string]$Region = "us-east-1",
    [string]$ApiUrl = "https://iyj02gvt12.execute-api.us-east-1.amazonaws.com",
    [string]$WebSocketUrl = "wss://iyj02gvt12.execute-api.us-east-1.amazonaws.com/prod"
)

$ErrorActionPreference = "Stop"

# Color output functions
function Write-Info($msg) { Write-Host $msg -ForegroundColor Cyan }
function Write-Success($msg) { Write-Host $msg -ForegroundColor Green }
function Write-Err($msg) { Write-Host $msg -ForegroundColor Red }
function Write-Warn($msg) { Write-Host $msg -ForegroundColor Yellow }

# Your 4 Amplify Apps
$AmplifyApps = @(
    @{ Name = "Web (Main)"; AppId = "d3pm78r41ma6w6"; Branch = "master"; Domain = "areacode.co.za" },
    @{ Name = "Admin"; AppId = "d1ay6jict0ql9w"; Branch = "main"; Domain = "admin.areacode.co.za" },
    @{ Name = "Business"; AppId = "dbp54yxhyjvk0"; Branch = "main"; Domain = "business.areacode.co.za" },
    @{ Name = "Staff"; AppId = "d166bb81tg4k61"; Branch = "main"; Domain = "staff.areacode.co.za" }
)

Write-Host ""
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "  Updating All Area Code Amplify Apps" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""
Write-Info "API Endpoint: $ApiUrl"
Write-Info "Region: $Region"
Write-Host ""

$successCount = 0
$failCount = 0

foreach ($app in $AmplifyApps) {
    Write-Host "----------------------------------------"
    Write-Info "Updating: $($app.Name)"
    Write-Info "  App ID: $($app.AppId)"
    Write-Info "  Branch: $($app.Branch)"
    Write-Info "  Domain: $($app.Domain)"
    
    # Update environment variables
    Write-Host "  Setting environment variables..." -ForegroundColor Gray
    
    aws amplify update-branch `
        --app-id $app.AppId `
        --branch-name $app.Branch `
        --environment-variables "VITE_API_URL=$ApiUrl,VITE_SOCKET_URL=$ApiUrl,VITE_WEBSOCKET_URL=$WebSocketUrl" `
        --region $Region 2>&1 | Out-Null
    
    if ($LASTEXITCODE -eq 0) {
        Write-Success "  ✓ Environment variables updated"
        
        # Trigger new build
        Write-Host "  Triggering new build..." -ForegroundColor Gray
        aws amplify start-job `
            --app-id $app.AppId `
            --branch-name $app.Branch `
            --job-type RELEASE `
            --region $Region 2>&1 | Out-Null
        
        if ($LASTEXITCODE -eq 0) {
            Write-Success "  ✓ Build triggered successfully"
            $successCount++
        } else {
            Write-Warn "  ⚠ Build trigger failed"
            $failCount++
        }
    } else {
        Write-Err "  ✗ Failed to update environment variables"
        $failCount++
    }
    
    Write-Host ""
}

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "  Update Summary" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""
Write-Success "Successful: $successCount"
if ($failCount -gt 0) {
    Write-Err "Failed: $failCount"
}
Write-Host ""

if ($successCount -gt 0) {
    Write-Info "Builds are running! Monitor progress at:"
    Write-Host "https://$Region.console.aws.amazon.com/amplify/apps" -ForegroundColor Blue
    Write-Host ""
    Write-Warn "Estimated completion: 3-5 minutes"
    Write-Host ""
    Write-Info "After builds complete, your apps will use:"
    Write-Host "  API: $ApiUrl"
    Write-Host ""
}

if ($failCount -gt 0) {
    Write-Host ""
    Write-Warn "Some apps failed to update. Manual fix:"
    Write-Host "1. Go to https://$Region.console.aws.amazon.com/amplify/apps"
    Write-Host "2. Click each app → Environment Variables"
    Write-Host "3. Set: VITE_API_URL = $ApiUrl"
    Write-Host "4. Save and redeploy"
}
