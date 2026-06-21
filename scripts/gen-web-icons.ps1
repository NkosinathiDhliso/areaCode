# Generates home-screen / PWA icons for the web, business, admin, and staff
# apps from the master brand logo (brand/areacode-logo.png), with no external
# deps. Uses .NET System.Drawing.
#
# iOS Safari "Add to Home Screen" needs an apple-touch-icon PNG (it ignores
# favicon.ico). iOS composites transparency onto black, so we flatten the
# transparent logo onto the brand background (#0c1018) for a clean result.
#
# Run from anywhere:  pwsh scripts/gen-web-icons.ps1
Add-Type -AssemblyName System.Drawing

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
$source = Join-Path $repoRoot 'brand\areacode-logo.png'
if (-not (Test-Path $source)) { throw "Source logo not found: $source" }

# Brand background (#0c1018)
$bg = [System.Drawing.Color]::FromArgb(255, 12, 16, 24)

# Target apps (each has a public/ dir served at site root)
$apps = @('web', 'business', 'admin', 'staff')

# Icons to emit into every app's public dir: name => pixel size
$iconSizes = [ordered]@{
  'apple-touch-icon.png' = 180  # iOS home screen
  'icon-192.png'         = 192  # PWA / Android
  'icon-512.png'         = 512  # PWA splash / install
}

$logo = [System.Drawing.Image]::FromFile($source)
try {
  foreach ($app in $apps) {
    $publicDir = Join-Path $repoRoot "apps\$app\public"
    if (-not (Test-Path $publicDir)) { New-Item -ItemType Directory -Path $publicDir | Out-Null }

    foreach ($name in $iconSizes.Keys) {
      $size = $iconSizes[$name]
      $bmp = New-Object System.Drawing.Bitmap($size, $size)
      $g = [System.Drawing.Graphics]::FromImage($bmp)
      try {
        $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
        $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $g.Clear($bg)
        $g.DrawImage($logo, 0, 0, $size, $size)

        $out = Join-Path $publicDir $name
        $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
        Write-Output "Wrote $out ($size x $size)"
      } finally {
        $g.Dispose()
        $bmp.Dispose()
      }
    }
  }
} finally {
  $logo.Dispose()
}
