// Amplify_Env_Closure check (Deployment Parity R6.4).
//
// Diffs the `VITE_*` keys READ in the frontend source against the set of keys
// PROVISIONED by scripts/update-all-amplify-apps.ps1, in BOTH directions, so
// env drift is detectable in CI and the go-live check:
//
//   - used-but-unmanaged : a key read in apps/ or packages/ that the script
//     does not provision -> a real closure gap -> FAIL (non-zero exit), so the
//     CI quality gate (task 4.4) and the go-live check (task 4.3) can gate on it.
//   - managed-but-unused : a key the script provisions that nothing reads ->
//     surfaced as a warning (drift), never a hard failure. Empty today: the
//     stale `VITE_SOCKET_URL` that used to occupy it was removed (R6.3), from
//     both its legacy read in websocket.ts and the provisioning script.
//
// Static only: it greps source and parses the ps1 text. No AWS calls, so it is
// safe in CI. This is the R6.4 formalization of the two-direction drift the
// ps1's own inline "[drift]" warning only hints at.
//
// Usage (from the repo root):
//   node scripts/check-amplify-env-closure.mjs
//
// The pure functions (stripComments, extractUsedKeys, parseManagedKeys,
// computeClosure) are exported so the unit test (task 4.5) can exercise them
// against fixture strings without touching the filesystem.

import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(__dirname, '..')

/** The provisioning script whose managed key set is the source of truth. */
export const PS1_PATH = join(REPO_ROOT, 'scripts', 'update-all-amplify-apps.ps1')

/** Frontend source roots that read `import.meta.env.VITE_*`. */
const SOURCE_ROOTS = ['apps', 'packages']

/** Directory names never walked (mirrors the other repo scanners). */
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
 * Keys that ARE read in code but are legitimately NOT provisioned by the
 * Amplify script, so they are excluded from the used-but-unmanaged failure.
 * Each entry needs a reason: these are build-time defines, dev-only toggles,
 * or keys with an in-code default, none of which are Amplify branch env vars.
 * Keeping this list explicit (not a blanket skip) preserves the no-fallbacks
 * rule: a genuinely missing production key still fails loudly.
 */
export const USED_UNMANAGED_ALLOWLIST = new Set([
  // Dev-only mock toggle. Never set on a production Amplify branch; the mock
  // layer is dead code behind it in prod builds.
  'VITE_DEV_MOCK',
  // Build-time define injected at `vite build` (the commit sha for RUM release
  // tagging), not an Amplify-managed branch variable. The ps1 explicitly treats
  // it as an out-of-band key that survives the merge.
  'VITE_GIT_SHA',
  // Optional share deep-link override; the code carries a hardcoded prod
  // default ('https://areacode.co.za'), so an unset value is correct, not a gap.
  'VITE_APP_SHARE_URL',
  // Feature-flag keys are built dynamically (`VITE_FLAG_${name}`) and read as a
  // dev/runtime override with a `false` default; they are not Amplify config.
  'VITE_FLAG_LIVE_VIBE_ON_MAP',
  'VITE_FLAG_LIVE_VIBE_DECLARATION',
])

/**
 * Keys the script provisions that no static read will ever match, but which are
 * legitimately managed. Empty today: every managed key is read in code. The
 * stale `VITE_SOCKET_URL` that this list once anticipated has been removed
 * (R6.3). Add entries here (with a reason) only for a key that is consumed by a
 * non-`import.meta` mechanism.
 */
export const MANAGED_UNUSED_ALLOWLIST = new Set([])

/**
 * Remove comments from TS/TSX source so keys mentioned only in a comment do not
 * count as "read". Block comments go first, then line comments. Line-comment
 * stripping deliberately spares `://` (URLs) by requiring the char before `//`
 * not be a colon, and it never touches string contents, because the bracket
 * read form puts the key inside quotes (`env['VITE_API_URL']`).
 *
 * @param {string} text
 * @returns {string}
 */
export function stripComments(text) {
  const withoutBlocks = text.replace(/\/\*[\s\S]*?\*\//g, ' ')
  return withoutBlocks.replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

/**
 * Extract the set of `VITE_*` keys actually read in a source string. Matches
 * every form the apps use: `import.meta.env.VITE_X`, the bracketed
 * `import.meta.env['VITE_X']`, and the aliased reads (`meta.VITE_X`,
 * `env?.VITE_X`) that the shared libs (rum, websocket, mediaUrl) use. A broad
 * token scan is intentional: closure must reflect every real read regardless of
 * access style. Comments are stripped first, and partial tokens that end in `_`
 * (the `VITE_FLAG_` dynamic-key prefix) are dropped.
 *
 * @param {string} sourceText
 * @returns {string[]} sorted unique keys
 */
export function extractUsedKeys(sourceText) {
  const code = stripComments(sourceText)
  const keys = new Set()
  for (const match of code.matchAll(/VITE_[A-Z0-9_]+/g)) {
    const key = match[0]
    // Drop dynamic-key prefixes captured from template literals
    // (e.g. `VITE_FLAG_` in `` `VITE_FLAG_${name}` ``). A real key never ends
    // in an underscore.
    if (key.endsWith('_')) continue
    keys.add(key)
  }
  return [...keys].sort()
}

/**
 * Parse the set of managed `VITE_*` key names out of the ps1 text. Catches all
 * four forms the script uses to declare a managed key:
 *   1. Hashtable-literal keys:       `VITE_API_URL       = $ApiUrl`
 *   2. Bracket assignment:           `$managed['VITE_STAFF_URL'] = ...`
 *   3. Dotted assignment:            `$managed.VITE_X = ...`
 *   4. Helper call:                  `Set-ManagedKey $managed 'VITE_MAPBOX_TOKEN' ...`
 * `#` comment lines are stripped first so documentation and the `$env:VITE_*`
 * parameter defaults (the SOURCES, not the managed OUTPUT keys) are not counted.
 *
 * @param {string} ps1Text
 * @returns {string[]} sorted unique managed key names
 */
export function parseManagedKeys(ps1Text) {
  // Strip PowerShell line comments (leading `#`), preserving code lines.
  const code = ps1Text
    .split('\n')
    .map((line) => {
      const trimmed = line.trimStart()
      return trimmed.startsWith('#') ? '' : line
    })
    .join('\n')

  const keys = new Set()
  const patterns = [
    // Set-ManagedKey $map 'VITE_X' ...
    /Set-ManagedKey\s+\$\w+\s+'(VITE_[A-Z0-9_]+)'/g,
    // $map['VITE_X']
    /\$\w+\['(VITE_[A-Z0-9_]+)'\]/g,
    // $map.VITE_X
    /\$\w+\.(VITE_[A-Z0-9_]+)/g,
    // hashtable-literal key at line start: `VITE_X = ...`
    /^\s*(VITE_[A-Z0-9_]+)\s*=/gm,
  ]
  for (const pattern of patterns) {
    for (const match of code.matchAll(pattern)) keys.add(match[1])
  }
  return [...keys].sort()
}

/**
 * True when a repo-relative path is a frontend source file the closure covers:
 * a `.ts`/`.tsx` file that is not a declaration, test, or spec file.
 *
 * @param {string} relPath repo-relative path with forward slashes
 * @returns {boolean}
 */
export function isSourceFile(relPath) {
  if (!/\.(ts|tsx)$/.test(relPath)) return false
  if (/\.d\.ts$/.test(relPath)) return false
  if (/\.(test|spec)\.tsx?$/.test(relPath)) return false
  if (relPath.split('/').includes('__tests__')) return false
  return true
}

/**
 * The pure closure diff. Given the used and managed key sets and the two
 * allowlists, report both directions with allowlisted keys removed.
 *
 * @param {{ used: string[], managed: string[], usedUnmanagedAllowlist?: Set<string>, managedUnusedAllowlist?: Set<string> }} input
 * @returns {{ usedButUnmanaged: string[], managedButUnused: string[], allowlistedUsed: string[], allowlistedManaged: string[] }}
 */
export function computeClosure({
  used,
  managed,
  usedUnmanagedAllowlist = new Set(),
  managedUnusedAllowlist = new Set(),
}) {
  const usedSet = new Set(used)
  const managedSet = new Set(managed)

  const usedButUnmanaged = []
  const allowlistedUsed = []
  for (const key of [...usedSet].sort()) {
    if (managedSet.has(key)) continue
    if (usedUnmanagedAllowlist.has(key)) allowlistedUsed.push(key)
    else usedButUnmanaged.push(key)
  }

  const managedButUnused = []
  const allowlistedManaged = []
  for (const key of [...managedSet].sort()) {
    if (usedSet.has(key)) continue
    if (managedUnusedAllowlist.has(key)) allowlistedManaged.push(key)
    else managedButUnused.push(key)
  }

  return { usedButUnmanaged, managedButUnused, allowlistedUsed, allowlistedManaged }
}

/**
 * Recursively collect frontend source files under a directory.
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
      if (isSourceFile(rel)) out.push(abs)
    }
  }
}

/** Scan the source roots and return the sorted unique set of used VITE keys. */
export function scanUsedKeys() {
  const files = []
  for (const root of SOURCE_ROOTS) walk(join(REPO_ROOT, root), files)
  const keys = new Set()
  for (const abs of files) {
    let content
    try {
      content = readFileSync(abs, 'utf8')
    } catch {
      continue
    }
    for (const key of extractUsedKeys(content)) keys.add(key)
  }
  return [...keys].sort()
}

function main() {
  let ps1Text
  try {
    ps1Text = readFileSync(PS1_PATH, 'utf8')
  } catch (err) {
    console.error(`[env-closure] Could not read ${relative(REPO_ROOT, PS1_PATH)}.`)
    console.error(String(err))
    process.exit(1)
  }

  const used = scanUsedKeys()
  const managed = parseManagedKeys(ps1Text)
  const { usedButUnmanaged, managedButUnused, allowlistedUsed, allowlistedManaged } = computeClosure({
    used,
    managed,
    usedUnmanagedAllowlist: USED_UNMANAGED_ALLOWLIST,
    managedUnusedAllowlist: MANAGED_UNUSED_ALLOWLIST,
  })

  console.log(`[env-closure] Used VITE keys (read in apps/ + packages/): ${used.length}`)
  console.log(`[env-closure] Managed VITE keys (update-all-amplify-apps.ps1): ${managed.length}`)

  if (allowlistedUsed.length > 0) {
    console.log('[env-closure] Read but intentionally NOT Amplify-managed (allowlisted):')
    for (const key of allowlistedUsed) console.log(`  - ${key}`)
  }

  if (managedButUnused.length > 0) {
    console.log('[env-closure] managed-but-unused (provisioned but read nowhere) - drift, not a failure:')
    for (const key of managedButUnused) console.log(`  ~ ${key}`)
  }

  if (allowlistedManaged.length > 0) {
    console.log('[env-closure] Managed-but-unused but allowlisted (consumed off the import.meta path):')
    for (const key of allowlistedManaged) console.log(`  - ${key}`)
  }

  if (usedButUnmanaged.length > 0) {
    console.error(`[env-closure] FAIL: ${usedButUnmanaged.length} key(s) read in code but NOT provisioned:`)
    for (const key of usedButUnmanaged) console.error(`  x ${key}`)
    console.error('[env-closure] Add each to update-all-amplify-apps.ps1 for the apps that read it, or allowlist it with a reason.')
    process.exit(1)
  }

  console.log('[env-closure] PASS: every read VITE key is provisioned (no used-but-unmanaged gap).')
}

// CLI entry only when invoked directly, so the unit test can import the pure
// functions without triggering a filesystem walk or process.exit.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main()
}
