import { readdirSync, readFileSync } from 'node:fs'
import { join, posix, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, it, expect } from 'vitest'

/**
 * Dormant_Paths guard — proof-of-demand spec, task 0.4, Requirement 13.7.
 *
 * R13.7: no task in the proof-of-demand spec may enable a dormant or retired
 * path as a side effect. This file is the executable form of that rule, run by
 * `pnpm test` (and therefore by the ship gates in
 * `docs/decisions/proof-of-demand.md`). It greps the repo for the five locks
 * the spec could plausibly trip:
 *
 *   1. the phone-OTP `410 Gone` gate (`no-sms-no-phone-auth.md`),
 *   2. the retired `VITE_SOCKET_URL` env key (`tech.md`),
 *   3. the retired standalone gets/deals tab and its `/gets` redirect
 *      (`product.md`),
 *   4. the `DEV_MODE` guard around every synthetic-data return
 *      (`code-style.md`, `no-fallbacks-no-legacy.md`),
 *   5. the live-vibe feature flags staying unprovisioned (decision 6 in
 *      `docs/decisions/proof-of-demand.md`; provisioning is task 0.2's call
 *      alone).
 *
 * It complements, and does not duplicate, the guards that already exist:
 * `scripts/assert-phone-otp-disabled.ps1` (CI-only PowerShell lock on the auth
 * handler and the ESLint rules) and
 * `backend/src/features/rewards/__tests__/no-global-events-feed.test.ts` (route
 * surface of the rewards router). Those check different artefacts; this one
 * checks the repo-wide text of the retired paths and the unprovisioned flags,
 * which neither covers.
 *
 * **Validates: Requirements 13.7**
 */

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))

/** Directories that are never source: deps, build output, ephemeral worktrees. */
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', '.git', '.claude', '.turbo', '.expo', '.next'])

const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.html']

function read(relPath: string): string {
  return readFileSync(join(REPO_ROOT, relPath), 'utf8')
}

/** Repo-relative, forward-slashed path so failure messages are copy-pasteable. */
function rel(absPath: string): string {
  return absPath.slice(REPO_ROOT.length).split(sep).join(posix.sep)
}

/** Recursively collect files under `relDir` whose extension is in `extensions`. */
function collectFiles(relDir: string, extensions: string[]): string[] {
  const found: string[] = []

  function walk(absDir: string): void {
    let entries: ReturnType<typeof readdirSync>
    try {
      entries = readdirSync(absDir, { withFileTypes: true })
    } catch {
      return // directory absent in this checkout — nothing to scan
    }
    for (const entry of entries) {
      const abs = join(absDir, entry.name)
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(abs)
        continue
      }
      if (extensions.some((ext) => entry.name.endsWith(ext))) found.push(abs)
    }
  }

  walk(join(REPO_ROOT, relDir))
  return found
}

/** Every file under any of `relDirs` that contains `needle`, as repo-relative paths. */
function filesContaining(relDirs: string[], extensions: string[], needle: string): string[] {
  return relDirs
    .flatMap((dir) => collectFiles(dir, extensions))
    .filter((abs) => readFileSync(abs, 'utf8').includes(needle))
    .map(rel)
}

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1
}

const APP_SOURCE_DIRS = ['apps', 'packages', 'backend/src']

// ─── 0. The scanner itself ──────────────────────────────────────────────────
//
// Every "must be absent" assertion below is vacuous if the walker finds
// nothing. Pin that it reaches real source first, so a broken path or a widened
// skip list cannot turn this whole file green by accident.

describe('the repo scanner reaches real source', () => {
  it('finds source files in every scanned tree', () => {
    for (const dir of APP_SOURCE_DIRS) {
      expect(collectFiles(dir, SOURCE_EXTENSIONS).length, `${dir} must contain source files`).toBeGreaterThan(0)
    }
    expect(collectFiles('infra', ['.tf']).length, 'infra must contain Terraform files').toBeGreaterThan(0)
  })

  it('matches content it should match', () => {
    // VITE_WEBSOCKET_URL is the live key; if the needle search cannot find it,
    // the VITE_SOCKET_URL search below proves nothing.
    expect(filesContaining(APP_SOURCE_DIRS, SOURCE_EXTENSIONS, 'VITE_WEBSOCKET_URL').length).toBeGreaterThan(0)
  })
})

// ─── 1. Phone-OTP 410 gate ──────────────────────────────────────────────────

describe('phone-OTP gate is intact (no-sms-no-phone-auth.md)', () => {
  const handler = read('backend/src/features/auth/handler.ts')

  it('keeps the PHONE_OTP_DISABLED constant derived from a non-dev environment', () => {
    expect(handler).toContain('PHONE_OTP_DISABLED')
    expect(handler).toMatch(/const PHONE_OTP_DISABLED\s*=\s*process\.env\['AREA_CODE_ENV'\]\s*!==\s*'dev'/)
  })

  it('keeps the 410 Gone rejection helper', () => {
    expect(handler).toContain('function rejectIfPhoneOtpDisabled')
    expect(handler).toMatch(/reply\.status\(410\)/)
    expect(handler).toContain("code: 'phone_otp_disabled'")
  })

  it('still gates all eight dormant phone-OTP routes', () => {
    // consumer signup/login/verify-otp, business signup/login/verify-otp,
    // staff login/verify-otp. The routes stay wired for dev fixtures and
    // return 410 everywhere else; the gate count must not shrink.
    const dormantRoutes = [
      '/v1/auth/consumer/signup',
      '/v1/auth/consumer/login',
      '/v1/auth/consumer/verify-otp',
      '/v1/auth/business/signup',
      '/v1/auth/business/login',
      '/v1/auth/business/verify-otp',
      '/v1/auth/staff/login',
      '/v1/auth/staff/verify-otp',
    ]
    for (const route of dormantRoutes) {
      expect(handler, `dormant phone-OTP route ${route} must stay registered`).toContain(`'${route}',`)
    }
    expect(countOccurrences(handler, 'return rejectIfPhoneOtpDisabled(reply)')).toBeGreaterThanOrEqual(
      dormantRoutes.length,
    )
  })

  it('keeps the steering file that owns the decision', () => {
    expect(read('.kiro/steering/no-sms-no-phone-auth.md')).toContain('SMS and phone-OTP authentication')
  })
})

// ─── 2. VITE_SOCKET_URL stays retired ───────────────────────────────────────

describe('VITE_SOCKET_URL is not reintroduced (tech.md)', () => {
  it('is read nowhere in apps, packages or the backend', () => {
    const offenders = filesContaining(APP_SOURCE_DIRS, SOURCE_EXTENSIONS, 'VITE_SOCKET_URL')
    expect(offenders, 'VITE_SOCKET_URL is retired; the websocket client reads VITE_WEBSOCKET_URL only').toEqual([])
  })

  it('is not provisioned by update-all-amplify-apps.ps1', () => {
    expect(read('scripts/update-all-amplify-apps.ps1')).not.toContain('VITE_SOCKET_URL')
  })

  it('leaves VITE_WEBSOCKET_URL as the one websocket key the client reads', () => {
    const websocketClient = read('packages/shared/lib/websocket.ts')
    expect(websocketClient).toContain('VITE_WEBSOCKET_URL')
    expect(websocketClient).not.toContain('VITE_SOCKET_URL')
  })
})

// ─── 3. Retired gets/deals tab ──────────────────────────────────────────────

describe('the retired gets tab stays retired (product.md)', () => {
  const app = read('apps/web/src/App.tsx')

  it('keeps /gets as a redirect to the map and nothing else', () => {
    expect(app).toContain("if (path === '/gets') return 'map'")
    // Exactly one mention: the redirect. A second would mean /gets became a
    // real route target again (e.g. an entry in ROUTE_PATHS).
    expect(countOccurrences(app, "'/gets'")).toBe(1)
  })

  it('keeps /gets out of every other consumer surface', () => {
    const offenders = filesContaining(['apps/web/src'], SOURCE_EXTENSIONS, "'/gets'").filter(
      (path) => path !== 'apps/web/src/App.tsx',
    )
    expect(offenders, 'the standalone gets/deals surface is retired; gets surface on the map and feed').toEqual([])
  })

  it('keeps the consumer bottom nav at four tabs', () => {
    const nav = read('apps/web/src/components/BottomNav.tsx')
    expect(nav).toContain("type NavRoute = 'map' | 'ranks' | 'feed' | 'profile'")

    const itemsAt = nav.indexOf('const NAV_ITEMS')
    expect(itemsAt, 'NAV_ITEMS must exist in BottomNav').toBeGreaterThan(-1)
    const items = nav.slice(itemsAt, nav.indexOf('\n]', itemsAt))
    expect(countOccurrences(items, "route: '")).toBe(4)
  })
})

// ─── 4. DEV_MODE guards around synthetic data ───────────────────────────────

describe('DEV_MODE still guards synthetic data (code-style.md)', () => {
  it('defines DEV_MODE once, in shared/config/env.ts, off unless AREA_CODE_ENV is dev', () => {
    expect(read('backend/src/shared/config/env.ts')).toMatch(
      /export const DEV_MODE: boolean = APP_ENV === 'dev' && !process\.env\['AREA_CODE_FORCE_LIVE'\]/,
    )

    const declarations = collectFiles('backend/src', ['.ts'])
      .filter((abs) => !abs.includes('__tests__'))
      .filter((abs) => /(?:const|let|var)\s+DEV_MODE\b[^=\n]*=/.test(readFileSync(abs, 'utf8')))
      .map(rel)
    expect(declarations, 'DEV_MODE must have exactly one home').toEqual(['backend/src/shared/config/env.ts'])
  })

  it('never shadows DEV_MODE: every gate imports it from the shared config', () => {
    const gateFiles = collectFiles('backend/src', ['.ts'])
      .filter((abs) => !abs.includes('__tests__') && !abs.endsWith('.test.ts'))
      .filter((abs) => readFileSync(abs, 'utf8').includes('if (DEV_MODE'))

    expect(gateFiles.length, 'expected DEV_MODE gates in the backend').toBeGreaterThan(0)

    for (const abs of gateFiles) {
      // Collapse whitespace so multi-line import statements match too.
      const flat = readFileSync(abs, 'utf8').replace(/\s+/g, ' ')
      expect(flat, `${rel(abs)} must import DEV_MODE from shared/config/env.js`).toMatch(
        /import \{[^}]*\bDEV_MODE\b[^}]*\} from '[^']*config\/env\.js'/,
      )
    }
  })

  it('keeps the getLiveStats fixture behind the guard, as the first statement', () => {
    // This spec extends getLiveStats (task 3.6, the Found_You / Walk_In split).
    // The dev fixture must stay inside the DEV_MODE branch: the real read must
    // never be bypassed in prod, and the fixture must never leak into it.
    const service = read('backend/src/features/business/service.ts')
    const start = service.indexOf('export async function getLiveStats')
    expect(start, 'getLiveStats must exist in the business service').toBeGreaterThan(-1)

    const after = service.slice(start + 1)
    const end = after.indexOf('\nexport ')
    const body = end === -1 ? after : after.slice(0, end)

    const guardAt = body.indexOf('if (DEV_MODE)')
    expect(guardAt, 'getLiveStats must open with a DEV_MODE guard').toBeGreaterThan(-1)
    const firstReturnAt = body.indexOf('return')
    expect(firstReturnAt, 'no return may precede the DEV_MODE guard').toBeGreaterThan(guardAt)
  })
})

// ─── 5. Live-vibe flags stay unprovisioned ──────────────────────────────────

describe('live-vibe flags stay unprovisioned (proof-of-demand decision 6)', () => {
  it('sets no AREA_CODE_FLAG_* variable in any Terraform file', () => {
    const offenders = collectFiles('infra', ['.tf', '.tfvars'])
      .filter((abs) => readFileSync(abs, 'utf8').includes('AREA_CODE_FLAG_'))
      .map(rel)
    expect(
      offenders,
      "provisioning a live-vibe flag is task 0.2's explicit decision, not a side effect of another task",
    ).toEqual([])
  })

  it('provisions no VITE_FLAG_* key through the Amplify script', () => {
    expect(read('scripts/update-all-amplify-apps.ps1')).not.toContain('VITE_FLAG_')
  })

  it('leaves both live-vibe flags defaulting to false', () => {
    const gating = read('packages/shared/lib/featureGating.ts')
    expect(gating).toMatch(/live_vibe_on_map:\s*false/)
    expect(gating).toMatch(/live_vibe_declaration:\s*false/)
  })

  it('keeps the recorded decision that the flags are not provisioned', () => {
    expect(read('docs/decisions/proof-of-demand.md')).toContain('Live-vibe flags: not provisioned')
  })
})
