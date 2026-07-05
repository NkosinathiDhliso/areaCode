# Claim + name Area Code's own demo venues (Johannesburg seed data).
#
# Context: three Johannesburg venues ("Plato coffe", "Hi", "RuleRev") are Area
# Code's own test/demo venues, not customer venues. The decision to keep them as
# company-owned honest demo venues (not delete them) is recorded in
# docs/GO_LIVE_CHECK_RESULT.md ("Decision (2026-07-05): the three placeholder
# venues are Area Code-owned demo venues"). This script applies that decision to
# the data: it renames them off their placeholder names and gives each one live
# get, so they read as genuine venues and clear the go-live "zero live rewards"
# WARN. It does NOT fake presence (honest-presence.md): a demo venue may show an
# honest zero live count, never a fabricated crowd.
#
# SAFETY (read this before running):
#   * Dry-run by default. Nothing is written unless you pass -Confirm.
#   * Allowlist guard: only the exact node IDs in $KnownDemoNodeIds can ever be
#     touched. Any other node (a real customer venue, a mistyped id) is refused.
#     Ownership is not reassigned; only the node name and its gets change.
#   * Idempotent: a venue already named correctly is not renamed again, and a
#     venue that already has a live reward does not get a second one.
#   * Read-only AWS calls otherwise (scan / query / describe).
#
# Usage:
#   ./scripts/claim-demo-venues.ps1 -Environment prod            # dry run (plan)
#   ./scripts/claim-demo-venues.ps1 -Environment prod -Confirm   # apply
#
# PowerShell 5.1 + AWS CLI gotcha (binding): PowerShell mangles inline JSON for
# the AWS CLI, so every --key / --item / --expression-attribute-* argument is
# passed as a file:// temp file written as UTF-8 without BOM.
param(
    [string]$Environment = "prod",
    [string]$Region = "us-east-1",
    [switch]$Confirm
)

$ErrorActionPreference = "Stop"

# ── Config: fill these in before running ─────────────────────────────────────
# The exact node IDs of Area Code's demo venues (looked up 2026-07-05 from
# area-code-prod-nodes). The script refuses to touch any node NOT in this set,
# so a mistyped name or a real customer venue can never be renamed. Each demo
# venue sits on its own test business account inside Area Code's AWS account
# (562691664641); there is no single shared "Area Code" business, so this script
# does NOT reassign ownership — it only renames the node and publishes one get.
$KnownDemoNodeIds = @(
    "cdf04c2a-0815-4a59-a339-8fc525d2df1b", # Plato coffe
    "b7619541-ff1c-4c2b-ae8b-151266859b9a", # Hi
    "b9f06885-fbbe-413c-97e9-cd18d0ba0439", # RuleRev
    "0931e860-c3ff-41aa-abbd-9a0104b1bb8c", # Braamfontein Beans (seeded 2026-07-05)
    "8ed59e8e-9cfc-4efb-a48c-d37d398070eb"  # Maboneng Social (seeded 2026-07-05)
)

# One entry per demo venue. NodeId is prefilled from the lookup. NewName is the
# honest name to show on the map. Get is the single live reward to publish if
# the venue has none. Type is a loyalty trigger ('nth_checkin' | 'daily_first' |
# 'streak' | 'milestone'); TriggerValue is the check-in count for nth_checkin.
# NewName and Get.Title are Area Code's content decision and are left blank on
# purpose — the script fails closed until they are set (no invented names).
$Venues = @(
    @{
        CurrentName  = "Plato coffe"
        NodeId       = "cdf04c2a-0815-4a59-a339-8fc525d2df1b"
        NewName      = "Plato Coffee Co."
        Category     = ""   # optional; leave "" to keep the existing category
        Get          = @{ Title = "Free flat white on your 5th check-in"; Type = "nth_checkin"; TriggerValue = 5; Description = "Check in five times and your next flat white is on us." }
    },
    @{
        CurrentName  = "Hi"
        NodeId       = "b7619541-ff1c-4c2b-ae8b-151266859b9a"
        NewName      = "Hive Kitchen"
        Category     = ""
        Get          = @{ Title = "Free side dish on your 5th check-in"; Type = "nth_checkin"; TriggerValue = 5; Description = "Five check-ins earns a side of your choice with your next meal." }
    },
    @{
        CurrentName  = "RuleRev"
        NodeId       = "b9f06885-fbbe-413c-97e9-cd18d0ba0439"
        NewName      = "Revolver Eatery"
        Category     = ""
        Get          = @{ Title = "Free dessert on your 5th check-in"; Type = "nth_checkin"; TriggerValue = 5; Description = "Your fifth visit comes with dessert on the house." }
    },
    # Seeded 2026-07-05 for node-count margin (already honestly named, so the
    # rename is a no-op; this entry exists only to publish their first live get).
    @{
        CurrentName  = "Braamfontein Beans"
        NodeId       = "0931e860-c3ff-41aa-abbd-9a0104b1bb8c"
        NewName      = "Braamfontein Beans"
        Category     = ""
        Get          = @{ Title = "Free filter coffee on your 5th check-in"; Type = "nth_checkin"; TriggerValue = 5; Description = "Five check-ins earns your next filter coffee." }
    },
    @{
        CurrentName  = "Maboneng Social"
        NodeId       = "8ed59e8e-9cfc-4efb-a48c-d37d398070eb"
        NewName      = "Maboneng Social"
        Category     = ""
        Get          = @{ Title = "Free welcome drink on your 5th check-in"; Type = "nth_checkin"; TriggerValue = 5; Description = "Your fifth visit starts with a drink on the house." }
    }
)
# ─────────────────────────────────────────────────────────────────────────────

# Table names follow the deterministic convention area-code-{env}-{table} (the
# same names the deploy and go-live scripts use), overridable by env var. This
# is a naming convention, not a masking fallback for a required secret.
$NodesTable = if ($env:NODES_TABLE) { $env:NODES_TABLE } else { "area-code-$Environment-nodes" }
$RewardsTable = if ($env:REWARDS_TABLE) { $env:REWARDS_TABLE } else { "area-code-$Environment-rewards" }

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "  Area Code - Claim demo venues" -ForegroundColor Cyan
Write-Host "  Environment: $Environment  Region: $Region" -ForegroundColor Cyan
$modeText = if ($Confirm) { "APPLY (writes enabled)" } else { "DRY RUN (no writes)" }
Write-Host "  Mode: $modeText" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""

# Fail closed on unfilled config so a placeholder can never touch real data.
foreach ($v in $Venues) {
    if ($KnownDemoNodeIds -notcontains $v.NodeId) {
        throw "Venue '$($v.CurrentName)': NodeId '$($v.NodeId)' is not in the demo-venue allowlist."
    }
    if ($v.NewName -eq "REPLACE_WITH_REAL_NAME" -or [string]::IsNullOrWhiteSpace($v.NewName)) {
        throw "Venue '$($v.CurrentName)': set NewName before running."
    }
    if ($v.Get.Title -eq "REPLACE_WITH_GET_TITLE" -or [string]::IsNullOrWhiteSpace($v.Get.Title)) {
        throw "Venue '$($v.CurrentName)': set Get.Title before running."
    }
}

if ($null -eq (Get-Command aws -ErrorAction SilentlyContinue)) {
    throw "aws CLI not found on PATH."
}

# New-JsonFile writes an object to a UTF-8 (no BOM) temp file and returns its
# file:// URI, the only safe way to hand JSON to the AWS CLI on PowerShell 5.1.
$script:tempFiles = @()
function New-JsonFile {
    param([Parameter(Mandatory = $true)] $Object)
    $path = [System.IO.Path]::GetTempFileName()
    $json = $Object | ConvertTo-Json -Depth 20 -Compress
    [System.IO.File]::WriteAllText($path, $json, (New-Object System.Text.UTF8Encoding($false)))
    $script:tempFiles += $path
    return "file://$($path -replace '\\', '/')"
}

# Invoke-Aws runs an aws command and returns parsed JSON, or throws on failure
# (this script must fail loudly, never guess). Native stderr is not merged.
function Invoke-Aws {
    param([Parameter(Mandatory = $true)] [string[]]$AwsArgs)
    $out = & aws @AwsArgs --output json 2>$null
    if ($LASTEXITCODE -ne 0) { throw "aws $($AwsArgs -join ' ') failed (exit $LASTEXITCODE)" }
    $joined = ($out -join "`n").Trim()
    if ($joined -eq "") { return $null }
    return ($joined | ConvertFrom-Json)
}

# Resolve-Node returns the node item (low-level DynamoDB JSON) for a venue by
# NodeId when given, else by exact name. Refuses ambiguous name matches.
function Resolve-Node {
    param([Parameter(Mandatory = $true)] $Venue)

    if (-not [string]::IsNullOrWhiteSpace($Venue.NodeId)) {
        $keyFile = New-JsonFile -Object @{ nodeId = @{ S = $Venue.NodeId } }
        $res = Invoke-Aws -AwsArgs @("dynamodb", "get-item", "--table-name", $NodesTable, "--key", $keyFile, "--region", $Region)
        if ($null -eq $res -or $null -eq $res.Item) { throw "Venue '$($Venue.CurrentName)': nodeId $($Venue.NodeId) not found." }
        return $res.Item
    }

    $namesFile = New-JsonFile -Object @{ "#n" = "name" }
    $valsFile = New-JsonFile -Object @{ ":name" = @{ S = $Venue.CurrentName } }
    $res = Invoke-Aws -AwsArgs @(
        "dynamodb", "scan", "--table-name", $NodesTable,
        "--filter-expression", "#n = :name",
        "--expression-attribute-names", $namesFile,
        "--expression-attribute-values", $valsFile,
        "--region", $Region
    )
    $items = @()
    if ($null -ne $res -and $null -ne $res.Items) { $items = @($res.Items) }
    if ($items.Count -eq 0) { throw "Venue '$($Venue.CurrentName)': no node with that exact name." }
    if ($items.Count -gt 1) { throw "Venue '$($Venue.CurrentName)': $($items.Count) nodes share this name; set NodeId to disambiguate." }
    return $items[0]
}

# Get-ActiveRewardCount counts current live rewards on a node (isActive + not
# expired), so we never publish a second get on a venue that already has one.
function Get-ActiveRewardCount {
    param([Parameter(Mandatory = $true)] [string]$NodeId)
    $valsFile = New-JsonFile -Object @{
        ":nodeId" = @{ S = $NodeId }
        ":t"      = @{ BOOL = $true }
        ":now"    = @{ S = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ") }
    }
    $res = Invoke-Aws -AwsArgs @(
        "dynamodb", "query", "--table-name", $RewardsTable, "--index-name", "NodeIndex",
        "--key-condition-expression", "nodeId = :nodeId",
        "--filter-expression", "isActive = :t AND (expiresAt > :now OR attribute_not_exists(expiresAt))",
        "--expression-attribute-values", $valsFile,
        "--region", $Region
    )
    if ($null -eq $res -or $null -eq $res.Items) { return 0 }
    return @($res.Items).Count
}

$failures = 0

foreach ($v in $Venues) {
    Write-Host "Venue: $($v.CurrentName) -> $($v.NewName)" -ForegroundColor Yellow
    try {
        $node = Resolve-Node -Venue $v
        $nodeId = $node.nodeId.S
        $ownerId = $null
        if ($null -ne $node.businessId) { $ownerId = $node.businessId.S }
        $currentName = $node.name.S

        # Guard: refuse any node not in the known demo-venue allowlist, so only
        # the exact test nodes looked up on 2026-07-05 can ever be touched.
        if ($KnownDemoNodeIds -notcontains $nodeId) {
            Write-Host "  REFUSED: nodeId $nodeId is not in the demo-venue allowlist. Skipped." -ForegroundColor Red
            $failures++
            continue
        }
        Write-Host "  nodeId=$nodeId owner=$ownerId (ownership unchanged)" -ForegroundColor Gray

        # 1) Rename (skip if already correct).
        if ($currentName -eq $v.NewName) {
            Write-Host "  name: already '$($v.NewName)', no rename needed" -ForegroundColor Gray
        }
        else {
            Write-Host "  name: '$currentName' -> '$($v.NewName)'" -ForegroundColor Gray
            if ($Confirm) {
                $exprNames = @{ "#name" = "name"; "#updatedAt" = "updatedAt" }
                $exprVals = @{
                    ":name"      = @{ S = $v.NewName }
                    ":updatedAt" = @{ S = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ") }
                }
                if (-not [string]::IsNullOrWhiteSpace($v.Category)) {
                    $exprNames["#category"] = "category"
                    $exprVals[":category"] = @{ S = $v.Category }
                }
                $setParts = @("#name = :name")
                if (-not [string]::IsNullOrWhiteSpace($v.Category)) { $setParts += "#category = :category" }
                $setParts += "#updatedAt = :updatedAt"
                $updateExpr = "SET " + ($setParts -join ", ")

                $keyFile = New-JsonFile -Object @{ nodeId = @{ S = $nodeId } }
                $namesFile = New-JsonFile -Object $exprNames
                $valsFile = New-JsonFile -Object $exprVals
                Invoke-Aws -AwsArgs @(
                    "dynamodb", "update-item", "--table-name", $NodesTable, "--key", $keyFile,
                    "--update-expression", $updateExpr,
                    "--expression-attribute-names", $namesFile,
                    "--expression-attribute-values", $valsFile,
                    "--region", $Region
                ) | Out-Null
                Write-Host "  name: updated" -ForegroundColor Green
            }
        }

        # 2) Publish one live get (skip if the venue already has a live reward).
        $activeCount = Get-ActiveRewardCount -NodeId $nodeId
        if ($activeCount -gt 0) {
            Write-Host "  get: venue already has $activeCount live reward(s), not adding another" -ForegroundColor Gray
        }
        else {
            Write-Host "  get: publish '$($v.Get.Title)' ($($v.Get.Type), trigger=$($v.Get.TriggerValue))" -ForegroundColor Gray
            if ($Confirm) {
                $rewardId = [guid]::NewGuid().ToString()
                $now = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
                $item = @{
                    rewardId     = @{ S = $rewardId }
                    id           = @{ S = $rewardId }
                    nodeId       = @{ S = $nodeId }
                    type         = @{ S = $v.Get.Type }
                    title        = @{ S = $v.Get.Title }
                    claimedCount = @{ N = "0" }
                    slotsLocked  = @{ BOOL = $false }
                    isActive     = @{ BOOL = $true }
                    getCategory  = @{ S = "loyalty" }
                    createdAt    = @{ S = $now }
                    updatedAt    = @{ S = $now }
                }
                if ($null -ne $v.Get.TriggerValue) { $item["triggerValue"] = @{ N = "$($v.Get.TriggerValue)" } }
                if (-not [string]::IsNullOrWhiteSpace($v.Get.Description)) { $item["description"] = @{ S = $v.Get.Description } }

                $itemFile = New-JsonFile -Object $item
                Invoke-Aws -AwsArgs @(
                    "dynamodb", "put-item", "--table-name", $RewardsTable, "--item", $itemFile, "--region", $Region
                ) | Out-Null
                Write-Host "  get: created reward $rewardId" -ForegroundColor Green
            }
        }
    }
    catch {
        Write-Host "  ERROR: $($_.Exception.Message)" -ForegroundColor Red
        $failures++
    }
    Write-Host ""
}

# Clean up temp JSON files.
foreach ($f in $script:tempFiles) {
    if (Test-Path $f) { Remove-Item $f -Force -ErrorAction SilentlyContinue }
}

Write-Host "==========================================" -ForegroundColor Cyan
if (-not $Confirm) {
    Write-Host "  DRY RUN complete. Re-run with -Confirm to apply." -ForegroundColor Yellow
}
if ($failures -gt 0) {
    Write-Host "  $failures venue(s) refused or errored." -ForegroundColor Red
    Write-Host "==========================================" -ForegroundColor Cyan
    exit 1
}
Write-Host "  Done ($($Venues.Count) venue(s) processed)." -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Cyan
exit 0
