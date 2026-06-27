#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Add SPA rewrite rules to all Area Code Amplify apps
.DESCRIPTION
    Configures the catch-all rewrite rule that serves index.html for all non-file
    routes. Required for client-side routing to work on direct URL access.
#>

param(
    [string]$Region = "us-east-1"
)

$ErrorActionPreference = "Stop"

function Write-Info($msg) { Write-Host $msg -ForegroundColor Cyan }
function Write-Success($msg) { Write-Host $msg -ForegroundColor Green }
function Write-Err($msg) { Write-Host $msg -ForegroundColor Red }

$AmplifyApps = @(
    @{ Name = "Web (Main)"; AppId = "d3pm78r41ma6w6" },
    @{ Name = "Admin"; AppId = "d1ay6jict0ql9w" },
    @{ Name = "Business"; AppId = "dbp54yxhyjvk0" },
    @{ Name = "Staff"; AppId = "d166bb81tg4k61" }
)

# SPA rewrite: any path without a static file extension -> index.html (200 rewrite)
$rulesJson = '[{"source":"</^[^.]+$|\\.(?!(css|gif|ico|jpg|jpeg|js|png|txt|xml|svg|woff|woff2|ttf|map|json|webmanifest|webp|avif)$)([^.]+$)/>","target":"/index.html","status":"200"}]'

Write-Host ""
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "  Adding SPA Rewrite Rules" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""
Write-Info "This ensures deep links, QR codes, and page refreshes work correctly."
Write-Host ""

$jsonFile = [System.IO.Path]::GetTempFileName()
[System.IO.File]::WriteAllText($jsonFile, $rulesJson)

$successCount = 0

foreach ($app in $AmplifyApps) {
    Write-Info "Updating: $($app.Name) ($($app.AppId))"

    $result = aws amplify update-app --app-id $app.AppId --custom-rules "file://$jsonFile" --region $Region --output text 2>&1

    if ($LASTEXITCODE -eq 0) {
        Write-Success "  Done"
        $successCount++
    } else {
        Write-Err "  Failed: $result"
    }
}

Remove-Item $jsonFile -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "==========================================" -ForegroundColor Cyan
Write-Success "$successCount / $($AmplifyApps.Count) apps updated"
Write-Host ""
Write-Info "No rebuild needed - rewrite rules take effect immediately."
Write-Host ""
