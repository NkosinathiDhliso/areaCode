# Generates the Expo app icon (1024x1024) on-brand, with no external deps.
# Uses .NET System.Drawing. Run from anywhere; writes to ../assets/icon.png.
Add-Type -AssemblyName System.Drawing

$size = 1024
$bmp = New-Object System.Drawing.Bitmap($size, $size)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic

# Brand background (#0c1018)
$bg = [System.Drawing.Color]::FromArgb(255, 12, 16, 24)
$g.Clear($bg)

# Accent ring (#A9CBE0) — a map-pin style ring centred in the canvas.
$accent = [System.Drawing.Color]::FromArgb(255, 169, 203, 224)
$accentDim = [System.Drawing.Color]::FromArgb(255, 90, 111, 138)

# Outer ring
$ringPen = New-Object System.Drawing.Pen($accent, 64)
$margin = 256
$g.DrawEllipse($ringPen, $margin, $margin, $size - 2 * $margin, $size - 2 * $margin)

# Inner dot
$dotBrush = New-Object System.Drawing.SolidBrush($accentDim)
$dotR = 120
$cx = $size / 2
$cy = $size / 2
$g.FillEllipse($dotBrush, $cx - $dotR, $cy - $dotR, 2 * $dotR, 2 * $dotR)

$assetsDir = Join-Path $PSScriptRoot '..\assets'
if (-not (Test-Path $assetsDir)) { New-Item -ItemType Directory -Path $assetsDir | Out-Null }
$out = Join-Path $assetsDir 'icon.png'
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)

$g.Dispose()
$bmp.Dispose()
$ringPen.Dispose()
$dotBrush.Dispose()
Write-Output "Wrote $out"
