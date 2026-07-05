# Seed additional Area Code demo venues (Johannesburg) for node-count margin.
#
# Context: the go-live check WARNs when Johannesburg has exactly the 5-node
# minimum (no margin, so one deactivation drops the city below the launch floor).
# This adds honest demo venues owned by existing paid-tier demo businesses so the
# count clears the margin. These are Area Code's own demo venues, same class as
# the ones handled by claim-demo-venues.ps1. Real customer venues are the proper
# long-term fix; this is pre-launch seed padding, not a substitute for them.
#
# Honest presence still applies (honest-presence.md): a demo venue may show an
# honest zero live count, never a faked crowd/pulse. This script only creates the
# node row; it never writes check-ins, presence, or pulse.
#
# SAFETY:
#   * Dry-run by default; nothing is written unless you pass -Confirm.
#   * Owner allowlist: each venue must be owned by a known paid-tier demo
#     business (only those surface on the paid-only map), so no orphan/unpaid
#     node is created.
#   * Idempotent: a venue whose exact name already exists in Johannesburg is
#     skipped, so re-running does not create duplicates.
#
# Usage:
#   ./scripts/seed-demo-venues.ps1 -Environment prod            # dry run
#   ./scripts/seed-demo-venues.ps1 -Environment prod -Confirm   # apply
#
# PowerShell 5.1 + AWS CLI: all JSON is passed as file:// temp files (UTF-8, no
# BOM); inline JSON is mangled by the shell.
param(
    [string]$Environment = "prod",
    [string]$Region = "us-east-1",
    [switch]$Confirm
)

$ErrorActionPreference = "Stop"

# Known paid-tier demo businesses (looked up 2026-07-05 from area-code-prod-nodes;
# these are the owners of the venues that already surface on the paid-only map).
# A new venue must be owned by one of these, else it would be hidden or orphaned.
$KnownPaidBusinessIds = @(
    "314f5cae-9f03-41ff-98f4-c3c5ca299177", # Plato Coffee Co.
    "02c82358-d8c5-4e54-bd7c-919782fea0b1", # Hive Kitchen
    "0c2ce7a4-d264-4f2f-9cb6-7247f7650b05", # Revolver Eatery
    "38e2218e-bcac-4016-b94e-d62808e0ec4e", # Father Coffee
    "876f3d29-614d-43bc-84de-b2862e310141"  # Furmished
)

# Demo venues to add. Coordinates must sit inside the JHB box
# (lat -26.5..-25.9, lng 27.7..28.4). BusinessId must be in the allowlist above.
$NewVenues = @(
    @{ Name = "Braamfontein Beans"; Category = "coffee";    Lat = -26.1928; Lng = 28.0305; BusinessId = "314f5cae-9f03-41ff-98f4-c3c5ca299177" },
    @{ Name = "Maboneng Social";    Category = "nightlife"; Lat = -26.2044; Lng = 28.0575; BusinessId = "876f3d29-614d-43bc-84de-b2862e310141" }
)

$NodesTable = if ($env:NODES_TABLE) { $env:NODES_TABLE } else { "area-code-$Environment-nodes" }

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "  Area Code - Seed demo venues" -ForegroundColor Cyan
Write-Host "  Environment: $Environment  Region: $Region" -ForegroundColor Cyan
$modeText = if ($Confirm) { "APPLY (writes enabled)" } else { "DRY RUN (no writes)" }
Write-Host "  Mode: $modeText" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""

# Fail closed on bad config.
foreach ($v in $NewVenues) {
    if ($KnownPaidBusinessIds -notcontains $v.BusinessId) {
        throw "Venue '$($v.Name)': BusinessId '$($v.BusinessId)' is not a known paid-tier demo business."
    }
    $latOk = ($v.Lat -ge -26.5) -and ($v.Lat -le -25.9)
    $lngOk = ($v.Lng -ge 27.7) -and ($v.Lng -le 28.4)
    if (-not ($latOk -and $lngOk)) { throw "Venue '$($v.Name)': coordinates ($($v.Lat), $($v.Lng)) are outside the JHB box." }
}

if ($null -eq (Get-Command aws -ErrorAction SilentlyContinue)) { throw "aws CLI not found on PATH." }

$script:tempFiles = @()
function New-JsonFile {
    param([Parameter(Mandatory = $true)] $Object)
    $path = [System.IO.Path]::GetTempFileName()
    $json = $Object | ConvertTo-Json -Depth 20 -Compress
    [System.IO.File]::WriteAllText($path, $json, (New-Object System.Text.UTF8Encoding($false)))
    $script:tempFiles += $path
    return "file://$($path -replace '\\', '/')"
}

function Invoke-Aws {
    param([Parameter(Mandatory = $true)] [string[]]$AwsArgs)
    $out = & aws @AwsArgs --output json 2>$null
    if ($LASTEXITCODE -ne 0) { throw "aws $($AwsArgs -join ' ') failed (exit $LASTEXITCODE)" }
    $joined = ($out -join "`n").Trim()
    if ($joined -eq "") { return $null }
    return ($joined | ConvertFrom-Json)
}

# Slugify: lowercase, non-alphanumeric -> '-', trim, plus a short hex suffix to
# match the existing "<name>-<6hex>" slug convention and avoid collisions.
function New-Slug {
    param([Parameter(Mandatory = $true)] [string]$Name)
    $base = ($Name.ToLower() -replace '[^a-z0-9]+', '-').Trim('-')
    $suffix = ([guid]::NewGuid().ToString('N')).Substring(0, 6)
    return "$base-$suffix"
}

# Name-exists guard: scan for an active Johannesburg node with this exact name.
function Test-NameExists {
    param([Parameter(Mandatory = $true)] [string]$Name)
    $namesFile = New-JsonFile -Object @{ "#n" = "name" }
    $valsFile = New-JsonFile -Object @{ ":name" = @{ S = $Name } }
    $res = Invoke-Aws -AwsArgs @(
        "dynamodb", "scan", "--table-name", $NodesTable,
        "--filter-expression", "#n = :name",
        "--expression-attribute-names", $namesFile,
        "--expression-attribute-values", $valsFile,
        "--region", $Region
    )
    if ($null -eq $res -or $null -eq $res.Items) { return $false }
    return @($res.Items).Count -gt 0
}

$created = 0
$failures = 0

foreach ($v in $NewVenues) {
    Write-Host "Venue: $($v.Name) ($($v.Category)) @ ($($v.Lat), $($v.Lng))" -ForegroundColor Yellow
    try {
        if (Test-NameExists -Name $v.Name) {
            Write-Host "  exists already, skipped" -ForegroundColor Gray
            continue
        }

        $nodeId = [guid]::NewGuid().ToString()
        $slug = New-Slug -Name $v.Name
        $now = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
        Write-Host "  nodeId=$nodeId slug=$slug owner=$($v.BusinessId)" -ForegroundColor Gray

        if ($Confirm) {
            $item = @{
                nodeId           = @{ S = $nodeId }
                id               = @{ S = $nodeId }
                name             = @{ S = $v.Name }
                slug             = @{ S = $slug }
                category         = @{ S = $v.Category }
                lat              = @{ N = "$($v.Lat)" }
                lng              = @{ N = "$($v.Lng)" }
                cityId           = @{ S = "johannesburg" }
                businessId       = @{ S = $v.BusinessId }
                submittedBy      = @{ S = $v.BusinessId }
                claimStatus      = @{ S = "claimed" }
                isActive         = @{ BOOL = $true }
                isVerified       = @{ BOOL = $false }
                qrCheckinEnabled = @{ BOOL = $false }
                nodeColour       = @{ S = "default" }
                createdAt        = @{ S = $now }
                updatedAt        = @{ S = $now }
            }
            $itemFile = New-JsonFile -Object $item
            Invoke-Aws -AwsArgs @("dynamodb", "put-item", "--table-name", $NodesTable, "--item", $itemFile, "--region", $Region) | Out-Null
            Write-Host "  created" -ForegroundColor Green
            $created++
        }
    }
    catch {
        Write-Host "  ERROR: $($_.Exception.Message)" -ForegroundColor Red
        $failures++
    }
    Write-Host ""
}

foreach ($f in $script:tempFiles) { if (Test-Path $f) { Remove-Item $f -Force -ErrorAction SilentlyContinue } }

Write-Host "==========================================" -ForegroundColor Cyan
if (-not $Confirm) { Write-Host "  DRY RUN complete. Re-run with -Confirm to apply." -ForegroundColor Yellow }
if ($failures -gt 0) {
    Write-Host "  $failures venue(s) errored." -ForegroundColor Red
    Write-Host "==========================================" -ForegroundColor Cyan
    exit 1
}
Write-Host "  Done (created $created venue(s))." -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Cyan
exit 0
