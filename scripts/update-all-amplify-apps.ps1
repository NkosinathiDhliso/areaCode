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
    [string]$WebSocketUrl = "wss://iyj02gvt12.execute-api.us-east-1.amazonaws.com/prod",
    [string]$MapboxToken = $env:VITE_MAPBOX_TOKEN,
    # CloudWatch RUM monitor + identity pool IDs per app.
    # Pull these from `terraform output -json rum_monitors` after applying.
    [string]$RumWebMonitorId = $env:RUM_WEB_MONITOR_ID,
    [string]$RumWebIdentityPool = $env:RUM_WEB_IDENTITY_POOL,
    [string]$RumBusinessMonitorId = $env:RUM_BUSINESS_MONITOR_ID,
    [string]$RumBusinessIdentityPool = $env:RUM_BUSINESS_IDENTITY_POOL,
    [string]$RumStaffMonitorId = $env:RUM_STAFF_MONITOR_ID,
    [string]$RumStaffIdentityPool = $env:RUM_STAFF_IDENTITY_POOL,
    [string]$RumAdminMonitorId = $env:RUM_ADMIN_MONITOR_ID,
    [string]$RumAdminIdentityPool = $env:RUM_ADMIN_IDENTITY_POOL
)

$ErrorActionPreference = "Stop"

# Color output functions
function Write-Info($msg) { Write-Host $msg -ForegroundColor Cyan }
function Write-Success($msg) { Write-Host $msg -ForegroundColor Green }
function Write-Err($msg) { Write-Host $msg -ForegroundColor Red }
function Write-Warn($msg) { Write-Host $msg -ForegroundColor Yellow }

# Your 4 Amplify Apps
$AmplifyApps = @(
    @{
        Name = "Web (Main)"; AppId = "d3pm78r41ma6w6"; Branch = "master"; Domain = "areacode.co.za"
        RumMonitorId = $RumWebMonitorId; RumIdentityPool = $RumWebIdentityPool
    },
    @{
        Name = "Admin"; AppId = "d1ay6jict0ql9w"; Branch = "master"; Domain = "admin.areacode.co.za"
        RumMonitorId = $RumAdminMonitorId; RumIdentityPool = $RumAdminIdentityPool
    },
    @{
        Name = "Business"; AppId = "dbp54yxhyjvk0"; Branch = "master"; Domain = "business.areacode.co.za"
        RumMonitorId = $RumBusinessMonitorId; RumIdentityPool = $RumBusinessIdentityPool
    },
    @{
        Name = "Staff"; AppId = "d166bb81tg4k61"; Branch = "master"; Domain = "staff.areacode.co.za"
        RumMonitorId = $RumStaffMonitorId; RumIdentityPool = $RumStaffIdentityPool
    }
)

Write-Host ""
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "  Updating All Area Code Amplify Apps" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""
Write-Info "API Endpoint: $ApiUrl"
if ($MapboxToken) {
    Write-Info "Mapbox Token: $($MapboxToken.Substring(0, [Math]::Min(10, $MapboxToken.Length)))..."
} else {
    Write-Warn "Mapbox Token: NOT SET (pass -MapboxToken or set VITE_MAPBOX_TOKEN env var)"
}
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
    
    # Build environment variables — Web (basemap) and Business (address
    # autocomplete via Mapbox Geocoding) both need the Mapbox token.
    $envVars = "VITE_API_URL=$ApiUrl,VITE_SOCKET_URL=$ApiUrl,VITE_WEBSOCKET_URL=$WebSocketUrl"
    if (($app.Name -eq "Web (Main)" -or $app.Name -eq "Business") -and $MapboxToken) {
        $envVars += ",VITE_MAPBOX_TOKEN=$MapboxToken"
    }
    if ($app.RumMonitorId -and $app.RumIdentityPool) {
        $envVars += ",VITE_RUM_APP_MONITOR_ID=$($app.RumMonitorId)"
        $envVars += ",VITE_RUM_IDENTITY_POOL_ID=$($app.RumIdentityPool)"
        $envVars += ",VITE_RUM_REGION=$Region"
    } else {
        Write-Warn "  ⚠ RUM env vars not provided for $($app.Name) — frontend monitoring will be disabled"
    }

    aws amplify update-branch `
        --app-id $app.AppId `
        --branch-name $app.Branch `
        --environment-variables $envVars `
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
