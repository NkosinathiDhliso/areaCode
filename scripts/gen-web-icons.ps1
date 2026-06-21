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

# favicon.ico is rebuilt as a multi-resolution icon so browser tabs stay crisp
# on high-DPI displays (the old file was a single blurry 32x32 frame).
$icoSizes = @(16, 32, 48, 64, 128, 256)

# Renders the logo flattened onto the brand background at $size px and returns
# the PNG-encoded bytes.
function Get-IconPngBytes([System.Drawing.Image]$logo, [int]$size, [System.Drawing.Color]$bg) {
  $bmp = New-Object System.Drawing.Bitmap($size, $size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  try {
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.Clear($bg)
    $g.DrawImage($logo, 0, 0, $size, $size)
    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    return $ms.ToArray()
  } finally {
    $g.Dispose()
    $bmp.Dispose()
  }
}

# Writes a multi-resolution .ico containing PNG-encoded frames (Vista+ format).
function Write-MultiResIco([string]$path, [hashtable]$frames, [int[]]$sizes) {
  $fs = New-Object System.IO.FileStream($path, [System.IO.FileMode]::Create)
  $bw = New-Object System.IO.BinaryWriter($fs)
  try {
    # ICONDIR
    $bw.Write([uint16]0)            # reserved
    $bw.Write([uint16]1)            # type = icon
    $bw.Write([uint16]$sizes.Count) # image count

    # Directory entries are 16 bytes each; image data starts after all of them.
    $offset = 6 + (16 * $sizes.Count)
    foreach ($s in $sizes) {
      $data = $frames[$s]
      $dim = if ($s -ge 256) { 0 } else { $s }  # 0 means 256
      $bw.Write([byte]$dim)          # width
      $bw.Write([byte]$dim)          # height
      $bw.Write([byte]0)             # color palette
      $bw.Write([byte]0)             # reserved
      $bw.Write([uint16]1)           # color planes
      $bw.Write([uint16]32)          # bits per pixel
      $bw.Write([uint32]$data.Length)# bytes in resource
      $bw.Write([uint32]$offset)     # offset to data
      $offset += $data.Length
    }
    foreach ($s in $sizes) {
      $data = $frames[$s]
      $bw.Write($data, 0, $data.Length)
    }
  } finally {
    $bw.Dispose()
    $fs.Dispose()
  }
}

$logo = [System.Drawing.Image]::FromFile($source)
try {
  foreach ($app in $apps) {
    $publicDir = Join-Path $repoRoot "apps\$app\public"
    if (-not (Test-Path $publicDir)) { New-Item -ItemType Directory -Path $publicDir | Out-Null }

    foreach ($name in $iconSizes.Keys) {
      $size = $iconSizes[$name]
      $out = Join-Path $publicDir $name
      [System.IO.File]::WriteAllBytes($out, (Get-IconPngBytes $logo $size $bg))
      Write-Output "Wrote $out ($size x $size)"
    }

    # Multi-resolution favicon.ico
    $frames = @{}
    foreach ($s in $icoSizes) { $frames[$s] = Get-IconPngBytes $logo $s $bg }
    $icoOut = Join-Path $publicDir 'favicon.ico'
    Write-MultiResIco $icoOut $frames $icoSizes
    Write-Output "Wrote $icoOut (multi-res: $($icoSizes -join ', '))"
  }
} finally {
  $logo.Dispose()
}
