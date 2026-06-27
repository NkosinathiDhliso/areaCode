<#
  CI guard: verifies no typographic dashes leak into shippable frontend assets.

  Em dashes (and their look-alikes) kept surfacing in user-facing surfaces -
  the browser tab title, the meta/OpenGraph description Google reads, PWA
  manifest copy, and in-app strings. Source code must use a plain hyphen-minus
  (-) only. This guard fails the build if any banned dash character appears in
  the frontend source that ships to users, so it can never resurface.

  Banned characters (all normalised to '-'):
    U+2012 figure dash
    U+2013 en dash
    U+2014 em dash
    U+2015 horizontal bar
    U+2212 minus sign

  Scope: apps/ and packages/ source that reaches the browser. Generated build
  output (dist) and dependencies (node_modules) are excluded - dist is rebuilt
  from this (clean) source.

  Usage:
    pwsh ./scripts/assert-no-em-dashes.ps1          # check (CI): exit 1 if any found
    pwsh ./scripts/assert-no-em-dashes.ps1 -Fix     # rewrite offenders to '-'

  Companion check to the other architecture locks in quality-gate.yml.
#>

param(
  [switch]$Fix
)

$ErrorActionPreference = 'Stop'

# Banned dash code points, all replaced by hyphen-minus.
$bannedChars = @(
  [char]0x2012, # figure dash
  [char]0x2013, # en dash
  [char]0x2014, # em dash
  [char]0x2015, # horizontal bar
  [char]0x2212  # minus sign
)

$root = Split-Path -Parent $PSScriptRoot
$targets = @(
  (Join-Path $root 'apps'),
  (Join-Path $root 'packages')
)
$extensions = @('*.tsx', '*.ts', '*.jsx', '*.js', '*.html', '*.css', '*.json', '*.webmanifest')

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$offenders = @()
$fixedCount = 0

foreach ($target in $targets) {
  if (-not (Test-Path $target)) { continue }
  Get-ChildItem -Path $target -Recurse -File -Include $extensions |
    Where-Object { $_.FullName -notmatch '[\\/]node_modules[\\/]' -and $_.FullName -notmatch '[\\/]dist[\\/]' } |
    ForEach-Object {
      $path = $_.FullName
      $content = [System.IO.File]::ReadAllText($path)
      $hasBanned = $false
      foreach ($c in $bannedChars) {
        if ($content.Contains($c)) { $hasBanned = $true; break }
      }
      if (-not $hasBanned) { return }

      if ($Fix) {
        $new = $content
        foreach ($c in $bannedChars) { $new = $new.Replace($c, '-') }
        [System.IO.File]::WriteAllText($path, $new, $utf8NoBom)
        $fixedCount++
        Write-Host "Fixed: $($path.Substring($root.Length + 1))"
      }
      else {
        # Record each offending line for a precise CI failure message.
        $lines = $content -split "`n"
        for ($i = 0; $i -lt $lines.Length; $i++) {
          foreach ($c in $bannedChars) {
            if ($lines[$i].Contains($c)) {
              $rel = $path.Substring($root.Length + 1)
              $offenders += ("  - {0}:{1}" -f $rel, ($i + 1))
              break
            }
          }
        }
      }
    }
}

if ($Fix) {
  Write-Host "Dash normalisation complete. Files changed: $fixedCount"
}
elseif ($offenders.Count -gt 0) {
  Write-Error @"
Typographic dash check FAILED.

Banned dash characters (em -, en -, horizontal bar, figure dash, minus sign)
were found in shippable frontend source. Use a plain hyphen-minus (-) instead.

These leak into the browser tab title, the meta description Google indexes,
the PWA manifest, and in-app copy. Run the auto-fix and re-commit:

  pwsh ./scripts/assert-no-em-dashes.ps1 -Fix

Offending lines:
$( $offenders | Out-String )
"@
  exit 1
}
else {
  Write-Host "No banned dash characters in frontend source."
}

# ---------------------------------------------------------------------------
# Separator rule: pure user-facing copy must use a pipe ' | ', never a spaced
# hyphen ' - ', as a separator. Scoped to surfaces where every string is
# user-visible (locale catalogues + the web app's <head>), so there are no
# false positives from compound words (real-time, check-in) or code/comments,
# which live elsewhere and legitimately use hyphens.
# ---------------------------------------------------------------------------
$spacedHyphen = ' ' + '-' + ' '
$pipeSep = ' | '

$separatorTargets = @()
$localeRoot = Join-Path $root 'apps'
if (Test-Path $localeRoot) {
  $separatorTargets += Get-ChildItem -Path $localeRoot -Recurse -File -Filter '*.json' |
    Where-Object { $_.FullName -match '[\\/]i18n[\\/]locales[\\/]' -and $_.FullName -notmatch '[\\/]node_modules[\\/]' }
}
$indexHtml = Join-Path $root 'apps/web/index.html'
if (Test-Path $indexHtml) { $separatorTargets += Get-Item $indexHtml }

$sepOffenders = @()
$sepFixed = 0
foreach ($file in $separatorTargets) {
  $path = $file.FullName
  $content = [System.IO.File]::ReadAllText($path)
  $isHtml = $path.ToLower().EndsWith('.html')

  # For HTML, ignore <!-- comments --> so the rule only governs visible copy
  # (title, meta content). JSON locale files have no comments to strip.
  $scanContent = if ($isHtml) { [regex]::Replace($content, '(?s)<!--.*?-->', '') } else { $content }
  if (-not $scanContent.Contains($spacedHyphen)) { continue }

  if ($Fix) {
    if ($isHtml) {
      # Replace ' - ' only outside comment regions.
      $parts = [regex]::Split($content, '(?s)(<!--.*?-->)')
      for ($p = 0; $p -lt $parts.Length; $p++) {
        if ($parts[$p] -notmatch '^<!--') { $parts[$p] = $parts[$p].Replace($spacedHyphen, $pipeSep) }
      }
      $new = -join $parts
    }
    else {
      $new = $content.Replace($spacedHyphen, $pipeSep)
    }
    [System.IO.File]::WriteAllText($path, $new, $utf8NoBom)
    $sepFixed++
    Write-Host "Fixed separator: $($path.Substring($root.Length + 1))"
  }
  else {
    if ($scanContent.Contains($spacedHyphen)) {
      $sepOffenders += ("  - {0} (visible copy)" -f $path.Substring($root.Length + 1))
    }
  }
}

if ($Fix) {
  Write-Host "Separator normalisation complete. Files changed: $sepFixed"
  exit 0
}

if ($sepOffenders.Count -gt 0) {
  Write-Error @"
User-facing separator check FAILED.

A spaced hyphen ' - ' is being used as a separator in user-facing copy
(locale catalogues or the web <head>). Use a pipe ' | ' instead - it reads
as a clean separator and avoids the over-hyphenated look. Auto-fix:

  pwsh ./scripts/assert-no-em-dashes.ps1 -Fix

For full sentences, prefer proper punctuation (a comma or full stop) over a
pipe. Offending lines:
$( $sepOffenders | Out-String )
"@
  exit 1
}

Write-Host "User-facing copy uses pipe separators (no spaced hyphens)."
exit 0
