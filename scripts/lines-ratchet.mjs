// Lines_Baseline ratchet (Audit Gap Closure R5.1, R5.2).
//
// Enforces the `code-style.md` 400-line hard limit on source files without a
// big-bang rewrite. The current violators are frozen once into
// `eslint-lines-baseline.json` at the repo root; from then on the baseline may
// only shrink. This script is the growth gate CI runs:
//
//   - a NEW source file (not in the baseline) over the limit -> FAIL
//   - a baselined file that GREW past its recorded count       -> FAIL
//   - a baselined file that shrank or dropped under the limit  -> allowed
//     (and reported as prunable; regenerate to ratchet the baseline down)
//
// The same file list and line-count function drive both generation and the
// check, so the frozen counts and the live counts are always measured the same
// way. The ESLint flat config reads the same JSON to switch `max-lines` off for
// the exact set of exempted files (see eslint.config.js).
//
// Usage (from the repo root):
//   node scripts/lines-ratchet.mjs            # check; non-zero exit on growth
//   node scripts/lines-ratchet.mjs --generate # (re)write the baseline
//
// The pure decision core (evaluateRatchet) and countLines are exported so the
// unit test can exercise them without touching the filesystem.

import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(__dirname, '..')

/** The `code-style.md` hard limit. */
export const LINE_LIMIT = 400

/** Baseline file (repo root). Consumed here and by eslint.config.js. */
export const BASELINE_PATH = join(REPO_ROOT, 'eslint-lines-baseline.json')

/** Source roots ESLint's `max-lines` rule covers. */
const SOURCE_ROOTS = ['apps', 'packages', 'backend']

/** Directory names never walked (mirror the ESLint flat-config ignores). */
const IGNORED_DIRS = new Set([
  'node_modules',
  'dist',
  '.turbo',
  'coverage',
  '.claude',
  '.expo',
  'build',
])

/**
 * True when a repo-relative path is a source file the limit applies to: a
 * `.ts`/`.tsx` file that is not a test, spec, config, or declaration file.
 * Mirrors the `files`/`ignores` of the ESLint `max-lines` block so the ratchet
 * and the linter reason about the same set.
 *
 * @param {string} relPath repo-relative path with forward slashes
 * @returns {boolean}
 */
export function isSourceFile(relPath) {
  if (!/\.(ts|tsx)$/.test(relPath)) return false
  if (/\.d\.ts$/.test(relPath)) return false
  if (/\.(test|spec)\.tsx?$/.test(relPath)) return false
  if (/\.config\.(ts|tsx|mts|cts)$/.test(relPath)) return false
  if (relPath.split('/').includes('__tests__')) return false
  return true
}

/**
 * Count the lines in a file the way the ratchet freezes them: every physical
 * line (blank lines and comments included, matching `skipBlankLines: false,
 * skipComments: false`), not counting the phantom trailing line a final
 * newline produces. Deterministic; generation and check share it.
 *
 * @param {string} content
 * @returns {number}
 */
export function countLines(content) {
  if (content === '') return 0
  const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const lines = normalized.split('\n')
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  return lines.length
}

/**
 * Recursively collect source files under a directory, skipping ignored dirs.
 * @param {string} absDir
 * @param {string[]} out
 */
function walk(absDir, out) {
  let entries
  try {
    entries = readdirSync(absDir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue
      walk(join(absDir, entry.name), out)
    } else if (entry.isFile()) {
      const abs = join(absDir, entry.name)
      const rel = relative(REPO_ROOT, abs).split(sep).join('/')
      if (isSourceFile(rel)) out.push(rel)
    }
  }
}

/**
 * Measure every source file under the source roots.
 * @returns {Record<string, number>} repo-relative path -> line count
 */
export function measureSourceFiles() {
  const files = []
  for (const root of SOURCE_ROOTS) walk(join(REPO_ROOT, root), files)
  /** @type {Record<string, number>} */
  const counts = {}
  for (const rel of files) {
    try {
      counts[rel] = countLines(readFileSync(join(REPO_ROOT, rel), 'utf8'))
    } catch {
      // Unreadable file: skip rather than crash the gate.
    }
  }
  return counts
}

/**
 * The pure ratchet decision. Given the frozen baseline and the current line
 * counts, report growth failures and prunable (shrunk/removed) entries.
 *
 * Failures (any -> CI fails):
 *   - a file not in the baseline whose count exceeds the limit ("new_over_limit")
 *   - a baselined file whose count exceeds its frozen count ("grew")
 *
 * Prunable (informational, never a failure):
 *   - a baselined file now at or under the limit ("under_limit")
 *   - a baselined file that shrank but is still over the limit ("shrank")
 *   - a baselined file that no longer exists ("deleted")
 *
 * @param {{ limit: number, files: Record<string, number> }} baseline
 * @param {Record<string, number>} current
 * @returns {{ failures: Array<object>, prunable: Array<object> }}
 */
export function evaluateRatchet(baseline, current) {
  const limit = Number.isFinite(baseline?.limit) ? baseline.limit : LINE_LIMIT
  const frozen = baseline?.files ?? {}
  const failures = []
  const prunable = []

  for (const [path, count] of Object.entries(current)) {
    if (Object.prototype.hasOwnProperty.call(frozen, path)) {
      if (count > frozen[path]) {
        failures.push({ path, kind: 'grew', count, frozen: frozen[path], limit })
      }
    } else if (count > limit) {
      failures.push({ path, kind: 'new_over_limit', count, limit })
    }
  }

  for (const [path, frozenCount] of Object.entries(frozen)) {
    const count = current[path]
    if (count === undefined) {
      prunable.push({ path, reason: 'deleted', frozen: frozenCount })
    } else if (count <= limit) {
      prunable.push({ path, reason: 'under_limit', count, frozen: frozenCount })
    } else if (count < frozenCount) {
      prunable.push({ path, reason: 'shrank', count, frozen: frozenCount })
    }
  }

  return { failures, prunable }
}

/** Read the baseline JSON, or a limit-only empty baseline if it is absent. */
export function readBaseline() {
  try {
    const parsed = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'))
    return { limit: parsed.limit ?? LINE_LIMIT, files: parsed.files ?? {} }
  } catch {
    return { limit: LINE_LIMIT, files: {} }
  }
}

/** Regenerate the baseline from the current tree (every file over the limit). */
function generate() {
  const current = measureSourceFiles()
  const files = {}
  for (const path of Object.keys(current).sort()) {
    if (current[path] > LINE_LIMIT) files[path] = current[path]
  }
  const payload = {
    _comment:
      'Generated by scripts/lines-ratchet.mjs. Frozen line counts for files over the ' +
      'code-style.md 400-line limit. This list may only shrink: run ' +
      '`pnpm lint:lines:update` after reducing a file. Do not hand-edit to raise a count.',
    limit: LINE_LIMIT,
    files,
  }
  writeFileSync(BASELINE_PATH, JSON.stringify(payload, null, 2) + '\n')
  const count = Object.keys(files).length
  console.log(`[lines-ratchet] Wrote ${relative(REPO_ROOT, BASELINE_PATH)} with ${count} baselined file(s).`)
}

/** Check the current tree against the baseline; exit non-zero on growth. */
function check() {
  const baseline = readBaseline()
  const current = measureSourceFiles()
  const { failures, prunable } = evaluateRatchet(baseline, current)

  if (prunable.length > 0) {
    console.log('[lines-ratchet] Baseline can shrink (run `pnpm lint:lines:update` to ratchet down):')
    for (const p of prunable) {
      if (p.reason === 'deleted') console.log(`  removed   ${p.path} (was ${p.frozen})`)
      else if (p.reason === 'under_limit') console.log(`  under 400 ${p.path} (${p.count} <= ${LINE_LIMIT})`)
      else console.log(`  shrank    ${p.path} (${p.frozen} -> ${p.count})`)
    }
  }

  if (failures.length > 0) {
    console.error(`[lines-ratchet] FAIL: ${failures.length} file(s) violate the ${LINE_LIMIT}-line ratchet:`)
    for (const f of failures) {
      if (f.kind === 'new_over_limit') {
        console.error(`  NEW over limit  ${f.path} (${f.count} > ${f.limit})`)
      } else {
        console.error(`  GREW past frozen ${f.path} (${f.count} > ${f.frozen})`)
      }
    }
    console.error('[lines-ratchet] Split the file under 400 lines. The baseline only shrinks; it never grows.')
    process.exit(1)
  }

  const baselinedCount = Object.keys(baseline.files).length
  console.log(`[lines-ratchet] PASS: no growth. ${baselinedCount} file(s) baselined, none exceeded.`)
}

// CLI entry only when invoked directly, so the unit test can import the pure
// functions without triggering a filesystem walk or process.exit.
const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
if (invokedDirectly) {
  if (process.argv.includes('--generate') || process.argv.includes('--update')) {
    generate()
  } else {
    check()
  }
}
