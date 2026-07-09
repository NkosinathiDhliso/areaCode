// Generates the PWA assets that index.html / manifest.webmanifest reference but
// that aren't produced by gen-web-icons.ps1:
//
//   - apps/web/public/badge-72.png        (Android notification badge, monochrome)
//   - apps/web/public/splash/*.png        (iOS apple-touch-startup-image set)
//   - apps/web/public/screenshots/*.png   (manifest screenshots, install dialog)
//
// Run: node scripts/generate-pwa-assets.mjs
//
// Design follows the Area Code tokens (dark slate + glacier accent), matching
// scripts/generate-og-image.mjs. The app is portrait-locked (manifest
// orientation: portrait), so only portrait splash screens are emitted.

import { readdirSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const root = join(dirname(fileURLToPath(import.meta.url)), '..')

// sharp is a transitive dep — resolve it from the pnpm store without pinning.
function resolveSharp() {
  try {
    return require('sharp')
  } catch {
    const store = join(root, 'node_modules', '.pnpm')
    const dir = readdirSync(store).find((d) => d.startsWith('sharp@'))
    if (!dir) throw new Error('sharp not found in node_modules/.pnpm')
    return require(join(store, dir, 'node_modules', 'sharp'))
  }
}

const sharp = resolveSharp()
const publicDir = join(root, 'apps', 'web', 'public')

// --- Badge (72x72, monochrome) --------------------------------------------
// Android masks the badge to a white silhouette over the system accent, so we
// draw a simple white pulse glyph on transparent.
const badgeSvg = `<svg width="72" height="72" viewBox="0 0 72 72" xmlns="http://www.w3.org/2000/svg">
  <g fill="none" stroke="#ffffff" stroke-width="4">
    <circle cx="36" cy="36" r="10" stroke-opacity="0.95"/>
    <circle cx="36" cy="36" r="22" stroke-opacity="0.55"/>
    <circle cx="36" cy="36" r="32" stroke-opacity="0.25"/>
  </g>
  <circle cx="36" cy="36" r="6" fill="#ffffff"/>
</svg>`

// --- Splash background (shared) --------------------------------------------
// Renders the Area Code mark centred on the brand gradient at an exact pixel
// size. Element scale is relative to the shorter edge so it reads well from
// the smallest iPhone to the 12.9" iPad.
function splashSvg(w, h) {
  const s = Math.min(w, h)
  const cx = w / 2
  const cy = h / 2
  const r1 = s * 0.05
  const r2 = s * 0.105
  const r3 = s * 0.165
  const dot = s * 0.02
  const ringY = cy - s * 0.12
  const wordSize = Math.round(s * 0.095)
  const tagSize = Math.round(s * 0.032)
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0b1018"/>
      <stop offset="50%" stop-color="#111827"/>
      <stop offset="100%" stop-color="#1a2030"/>
    </linearGradient>
    <radialGradient id="glow" cx="50%" cy="40%" r="55%">
      <stop offset="0%" stop-color="#a9cbe0" stop-opacity="0.16"/>
      <stop offset="100%" stop-color="#778ca9" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#bg)"/>
  <rect width="${w}" height="${h}" fill="url(#glow)"/>
  <g transform="translate(${cx} ${ringY})" fill="none" stroke="#a9cbe0">
    <circle r="${r1}" stroke-opacity="0.9" stroke-width="${s * 0.006}"/>
    <circle r="${r2}" stroke-opacity="0.45" stroke-width="${s * 0.005}"/>
    <circle r="${r3}" stroke-opacity="0.2" stroke-width="${s * 0.004}"/>
  </g>
  <circle cx="${cx}" cy="${ringY}" r="${dot}" fill="#a9cbe0"/>
  <text x="${cx}" y="${cy + s * 0.16}" text-anchor="middle"
        font-family="'Syne','DM Sans',system-ui,-apple-system,sans-serif"
        font-size="${wordSize}" font-weight="800" letter-spacing="-2" fill="#e8ecf0">Area Code</text>
  <text x="${cx}" y="${cy + s * 0.22}" text-anchor="middle"
        font-family="'DM Sans',system-ui,-apple-system,sans-serif"
        font-size="${tagSize}" font-weight="500" fill="#9aa8b8">The city is alive. Now you can see it.</text>
</svg>`
}

// Portrait physical pixel sizes for current iPhone / iPad families.
const SPLASH_SIZES = [
  [1290, 2796],
  [1179, 2556],
  [1284, 2778],
  [1170, 2532],
  [1125, 2436],
  [1242, 2688],
  [828, 1792],
  [750, 1334],
  [2048, 2732],
  [1668, 2388],
  [1668, 2224],
  [1640, 2360],
  [1536, 2048],
]

async function main() {
  mkdirSync(publicDir, { recursive: true })
  mkdirSync(join(publicDir, 'splash'), { recursive: true })
  mkdirSync(join(publicDir, 'screenshots'), { recursive: true })

  await sharp(Buffer.from(badgeSvg)).png().toFile(join(publicDir, 'badge-72.png'))
  console.log('Wrote badge-72.png (72x72)')

  for (const [w, h] of SPLASH_SIZES) {
    const out = join(publicDir, 'splash', `splash-${w}x${h}.png`)
    await sharp(Buffer.from(splashSvg(w, h)))
      .png()
      .toFile(out)
    console.log(`Wrote splash/splash-${w}x${h}.png`)
  }

  // Manifest screenshots: one narrow (mobile) and one wide (desktop) so the
  // Android install dialog shows a richer card. Branded promo cards, not
  // fabricated UI.
  await sharp(Buffer.from(splashSvg(1080, 1920)))
    .png()
    .toFile(join(publicDir, 'screenshots', 'narrow.png'))
  console.log('Wrote screenshots/narrow.png (1080x1920)')

  await sharp(Buffer.from(splashSvg(1920, 1080)))
    .png()
    .toFile(join(publicDir, 'screenshots', 'wide.png'))
  console.log('Wrote screenshots/wide.png (1920x1080)')
}

await main()
