/**
 * Consumer web Bundle_Budget check (Release Quality and Ops Hygiene R9.3).
 *
 * Sums the gzip sizes of the INITIAL entry chunks of the consumer web build
 * (apps/web) and fails (non-zero exit) when the total exceeds the budget.
 *
 * "Initial" = the files loaded on first paint: every `isEntry` chunk plus the
 * chunks it pulls in through STATIC imports, plus their CSS. Lazy/dynamic
 * chunks (Mapbox GL, the business panels, anything reached via `import()`) are
 * excluded on purpose, because they do not block first paint.
 *
 * The budget is the post-split measurement plus 10 percent headroom, recorded
 * as a constant below. Per the Warning_Ratchet spirit, lower it when the build
 * shrinks; only raise it with a recorded reason.
 *
 * Usage: run AFTER `pnpm --filter @area-code/web build`, from the repo root:
 *   node scripts/check-bundle-budget.mjs
 *
 * The pure summing/decision functions are exported so the property test
 * (task 8.4) can exercise them without a real build.
 */

import { gzipSync } from 'node:zlib'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))

/**
 * Budget for the initial gzip total, in bytes. Set from the post-split
 * measurement (see task 8.5 before/after record) plus 10 percent headroom.
 *
 * Measured initial gzip total after the Phosphor tree-shake + vendor splits:
 * 385,610 bytes. Budget = ceil(385610 * 1.10) = 424,171 bytes (~414 KB gzip).
 */
export const BUDGET_BYTES = 424_171

const DIST_DIR = join(__dirname, '..', 'apps', 'web', 'dist')
const MANIFEST_PATH = join(DIST_DIR, '.vite', 'manifest.json')

/**
 * Sum the gzip sizes of exactly the initial chunk descriptors.
 *
 * Pure and total: descriptors flagged `initial` contribute their `size`, all
 * others contribute nothing, and an empty (or non-array) input sums to 0. Never
 * throws.
 *
 * @param {Array<{ name?: string, size?: number, initial?: boolean }>} chunkDescriptors
 * @returns {number} total bytes of the initial chunks
 */
export function sumInitialChunkBytes(chunkDescriptors) {
  if (!Array.isArray(chunkDescriptors)) return 0
  return chunkDescriptors.reduce((total, descriptor) => {
    if (!descriptor || descriptor.initial !== true) return total
    const size = Number(descriptor.size)
    return total + (Number.isFinite(size) && size > 0 ? size : 0)
  }, 0)
}

/**
 * The budget check: the total is within budget iff it does not exceed it.
 * Monotone in `total` (more bytes never turns a fail into a pass) and in
 * `budget` (a bigger budget never turns a pass into a fail).
 *
 * @param {number} total
 * @param {number} budget
 * @returns {boolean}
 */
export function isWithinBudget(total, budget) {
  return total <= budget
}

/**
 * Walk the Vite manifest from every entry chunk through its STATIC imports and
 * return the set of manifest keys that load on first paint. Dynamic imports are
 * not followed, so lazy chunks stay out of the initial set.
 *
 * @param {Record<string, { isEntry?: boolean, imports?: string[] }>} manifest
 * @returns {Set<string>} initial manifest keys
 */
export function collectInitialManifestKeys(manifest) {
  const initial = new Set()
  const visit = (key) => {
    if (initial.has(key)) return
    const chunk = manifest[key]
    if (!chunk) return
    initial.add(key)
    for (const imported of chunk.imports ?? []) visit(imported)
    // Deliberately NOT following chunk.dynamicImports: those are lazy.
  }
  for (const [key, chunk] of Object.entries(manifest)) {
    if (chunk.isEntry) visit(key)
  }
  return initial
}

/**
 * Turn a Vite manifest into gzip-sized chunk descriptors, reading each emitted
 * asset from `distDir` and flagging whether it is part of the initial payload.
 * JS chunk files and their CSS both count.
 *
 * @param {Record<string, any>} manifest
 * @param {string} distDir
 * @returns {Array<{ name: string, size: number, initial: boolean }>}
 */
export function buildChunkDescriptors(manifest, distDir) {
  const initialKeys = collectInitialManifestKeys(manifest)

  // A file is initial if ANY initial chunk references it (JS file or CSS).
  const initialFiles = new Set()
  for (const key of initialKeys) {
    const chunk = manifest[key]
    if (!chunk) continue
    if (chunk.file) initialFiles.add(chunk.file)
    for (const css of chunk.css ?? []) initialFiles.add(css)
  }

  const descriptors = []
  const seen = new Set()
  for (const chunk of Object.values(manifest)) {
    const files = [chunk.file, ...(chunk.css ?? [])].filter(Boolean)
    for (const file of files) {
      if (seen.has(file)) continue
      seen.add(file)
      const buffer = readFileSync(join(distDir, file))
      descriptors.push({
        name: file,
        size: gzipSync(buffer).length,
        initial: initialFiles.has(file),
      })
    }
  }
  return descriptors
}

function formatKB(bytes) {
  return `${(bytes / 1024).toFixed(2)} KB`
}

function main() {
  let manifest
  try {
    manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'))
  } catch (err) {
    console.error(`[bundle-budget] Could not read the Vite manifest at ${MANIFEST_PATH}.`)
    console.error('[bundle-budget] Run `pnpm --filter @area-code/web build` first.')
    console.error(String(err))
    process.exit(1)
  }

  const descriptors = buildChunkDescriptors(manifest, DIST_DIR)
  const total = sumInitialChunkBytes(descriptors)
  const within = isWithinBudget(total, BUDGET_BYTES)

  const initial = descriptors.filter((d) => d.initial).sort((a, b) => b.size - a.size)
  console.log('[bundle-budget] Initial chunks (gzip):')
  for (const d of initial) {
    console.log(`  ${formatKB(d.size).padStart(12)}  ${d.name}`)
  }
  console.log(`[bundle-budget] Initial gzip total: ${formatKB(total)} (${total} bytes)`)
  console.log(`[bundle-budget] Budget:             ${formatKB(BUDGET_BYTES)} (${BUDGET_BYTES} bytes)`)

  if (!within) {
    const over = total - BUDGET_BYTES
    console.error(`[bundle-budget] FAIL: over budget by ${formatKB(over)} (${over} bytes).`)
    console.error('[bundle-budget] Split more code behind dynamic import() or reduce the initial payload.')
    process.exit(1)
  }
  console.log('[bundle-budget] PASS: initial payload is within budget.')
}

// Only run the CLI when invoked directly, so the property test can import the
// pure functions without triggering a build read / process.exit.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main()
}
