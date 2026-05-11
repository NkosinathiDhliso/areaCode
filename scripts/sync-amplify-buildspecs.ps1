#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Push the per-app amplify.yml files into each Amplify app's stored
    buildSpec. Amplify's app-level buildSpec overrides the repo file, so if
    they drift (e.g. the repo was updated but the app still carries an old
    spec), every build uses the stale stored version.
.DESCRIPTION
    Reads apps/<app>/amplify.yml and calls `aws amplify update-app` with the
    contents as --build-spec for each of the 4 Area Code apps.
#>

param(
    [string]$Region = "us-east-1"
)

$ErrorActionPreference = "Stop"

$Apps = @(
    @{ Name = "web";      AppId = "d3pm78r41ma6w6" },
    @{ Name = "admin";    AppId = "d1ay6jict0ql9w" },
    @{ Name = "business"; AppId = "dbp54yxhyjvk0"  },
    @{ Name = "staff";    AppId = "d166bb81tg4k61" }
)

foreach ($app in $Apps) {
    $specPath = Join-Path -Path $PSScriptRoot -ChildPath "..\apps\$($app.Name)\amplify.yml"
    $spec = Get-Content $specPath -Raw
    Write-Host "Updating $($app.Name) ($($app.AppId))..." -ForegroundColor Cyan
    aws amplify update-app `
        --app-id $app.AppId `
        --build-spec $spec `
        --region $Region `
        --output json | Out-Null
    if ($LASTEXITCODE -eq 0) {
        Write-Host "  OK" -ForegroundColor Green
    } else {
        Write-Host "  FAILED" -ForegroundColor Red
        exit 1
    }
}

Write-Host ""
Write-Host "Stored buildSpecs synced. Re-run builds to verify." -ForegroundColor Green
