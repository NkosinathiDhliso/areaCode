// Generates apps/web/public/og-image.png (1200x630) — the social share card
// used by the og:image / twitter:image tags in apps/web/index.html.
//
// Run: node scripts/generate-og-image.mjs
//
// Design follows the Area Code tokens (packages/shared/tokens.css): dark slate
// gradient, glacier accent, zero purple. Re-run this if the brand changes.

import { readdirSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const root = join(dirname(fileURLToPath(import.meta.url)), '..')

// sharp is a transitive dep — resolve it from the pnpm store without pinning
// a version in this script.
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

const W = 1200
const H = 630

const svg = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0b1018"/>
      <stop offset="50%" stop-color="#111827"/>
      <stop offset="100%" stop-color="#1a2030"/>
    </linearGradient>
    <radialGradient id="glow" cx="78%" cy="32%" r="55%">
      <stop offset="0%" stop-color="#a9cbe0" stop-opacity="0.22"/>
      <stop offset="60%" stop-color="#778ca9" stop-opacity="0.06"/>
      <stop offset="100%" stop-color="#778ca9" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="accent" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#5a6f8a"/>
      <stop offset="50%" stop-color="#778ca9"/>
      <stop offset="100%" stop-color="#a9cbe0"/>
    </linearGradient>
  </defs>

  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <rect width="${W}" height="${H}" fill="url(#glow)"/>

  <!-- Pulse motif: concentric rings around a live dot, the product's core idea -->
  <g transform="translate(930 250)" fill="none" stroke="#a9cbe0">
    <circle r="38" stroke-opacity="0.9" stroke-width="3"/>
    <circle r="78" stroke-opacity="0.45" stroke-width="2.5"/>
    <circle r="122" stroke-opacity="0.22" stroke-width="2"/>
    <circle r="168" stroke-opacity="0.10" stroke-width="2"/>
  </g>
  <circle cx="930" cy="250" r="15" fill="#a9cbe0"/>

  <!-- Wordmark + tagline -->
  <text x="90" y="318" font-family="'Syne','DM Sans',system-ui,-apple-system,Segoe UI,sans-serif"
        font-size="118" font-weight="800" letter-spacing="-3" fill="#e8ecf0">Area Code</text>
  <text x="94" y="392" font-family="'DM Sans',system-ui,-apple-system,Segoe UI,sans-serif"
        font-size="40" font-weight="500" fill="#9aa8b8">The city is alive. Now you can see it.</text>

  <!-- Accent underline + context line -->
  <rect x="96" y="430" width="190" height="6" rx="3" fill="url(#accent)"/>
  <text x="96" y="486" font-family="'DM Sans',system-ui,-apple-system,Segoe UI,sans-serif"
        font-size="28" font-weight="500" fill="#5c6878" letter-spacing="1">
    Live venue map · Johannesburg · Cape Town · Durban
  </text>
</svg>`

const outDir = join(root, 'apps', 'web', 'public')
const outFile = join(outDir, 'og-image.png')
mkdirSync(outDir, { recursive: true })

await sharp(Buffer.from(svg)).png().toFile(outFile)
console.log(`Wrote ${outFile} (${W}x${H})`)
