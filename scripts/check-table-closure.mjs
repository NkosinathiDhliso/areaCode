// Table_Closure check (Deployment Parity R4.4).
//
// Statically verifies, with NO AWS calls, that every DynamoDB table a prod
// Lambda can reach through the shared `TableNames` accessors is backed by the
// IAM that Lambda actually holds. It parses two repo files:
//
//   - backend/src/shared/db/dynamodb.ts : the canonical set of table-name env
//     vars (`requireEnv('<X>_TABLE', ...)`), one per `TableNames` accessor.
//   - infra/environments/prod/main.tf   : each `module "lambda_*"` env block
//     (which of those `*_TABLE` vars it SETS) and every `aws_iam_role_policy`
//     that grants DynamoDB table ARNs (the shared `lambda_dynamodb` for_each
//     members plus the inline per-Lambda policies like
//     schedule-transition-tick and the campaign/report workers).
//
// The invariant it FAILS on (the real July-2026 runtime failure mode, e.g. the
// MusicSchedules AccessDenied):
//
//   For every table-name env var a Lambda SETS, that Lambda's effective
//   DynamoDB IAM must grant that table AND its `/index/*`, and the table must
//   resolve to a real `aws_dynamodb_table.<x>` resource.
//
// It does NOT fail the opposite asymmetry (a Lambda whose IAM is broader than
// its env, e.g. a shared-policy member that holds all-table IAM but only sets
// a subset of table env vars). That is harmless by design, so those cases are
// documented in BROAD_IAM_ALLOWLIST below (one reason each, seeded from the
// task 1.4 manual sweep) and reported as accepted, never as a gap.
//
// Static only: it reads and regex-parses the two files. No AWS, no terraform,
// so it is safe in CI (task 4.4) and the go-live check (task 4.3).
//
// Usage (from the repo root):
//   node scripts/check-table-closure.mjs
//
// The pure functions (stripHclComments, parseTableEnvVars, envVarToTableKey,
// parseDeclaredTables, parseLambdaTableEnv, parseDynamodbIam, computeClosure)
// are exported so the unit test (task 4.5) can exercise them against fixture
// strings without touching the filesystem.

import { readFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(__dirname, '..')

/** The source of truth for the table-name env vars (one per TableNames accessor). */
export const DYNAMODB_TS_PATH = join(REPO_ROOT, 'backend', 'src', 'shared', 'db', 'dynamodb.ts')

/** The prod Terraform whose Lambda env blocks and IAM policies are compared. */
export const PROD_TF_PATH = join(REPO_ROOT, 'infra', 'environments', 'prod', 'main.tf')

/**
 * Lambdas that legitimately hold BROADER DynamoDB IAM than the table env vars
 * they set, so their env-narrower-than-IAM asymmetry is accepted, not a gap.
 * Every entry is a member of the shared `lambda_dynamodb` policy (which grants
 * all eight tables to each member) that only sets the subset of `*_TABLE` env
 * vars for the tables its code path actually touches. Reasons seeded from the
 * task 1.4 manual Table_Closure sweep. This list never suppresses the hard
 * check (env not covered by IAM), only the harmless broad-IAM reverse note.
 *
 * Not listed: `partition_manager` holds no DynamoDB IAM and sets no table env
 * (env is only AREA_CODE_ENV), so it is not an asymmetry at all. `api` sets and
 * is granted all eight, so it has no asymmetry either.
 *
 * @type {Map<string, string>} lambda key -> reason
 */
export const BROAD_IAM_ALLOWLIST = new Map([
  ['pulse_decay', 'Shared policy grants all tables; pulse sweep sets USERS/APP_DATA/NODES only.'],
  ['reward_evaluator', 'Shared policy grants all tables; evaluator sets REWARDS/APP_DATA/NODES/CHECKINS.'],
  ['leaderboard_reset', 'Shared policy grants all tables; reset only touches APP_DATA (leaderboard KV).'],
  ['cleanup', 'Shared policy grants all tables; POPIA/billing sweep sets USERS/CHECKINS/APP_DATA/BUSINESSES/NODES/REWARDS.'],
  ['websocket', 'Shared policy grants all tables; $connect identity resolution sets USERS/BUSINESSES/APP_DATA only.'],
  ['presence_expiry', 'Shared policy grants all tables; sweep sets USERS/NODES/APP_DATA/PRESENCE.'],
  ['streak_reminder', 'Shared policy grants all tables; reminder sets USERS/CHECKINS/APP_DATA.'],
])

/**
 * Strip HCL comments so a table env var or table ARN mentioned only in a
 * comment does not count. Only line comments are stripped: `#` (HCL's primary
 * form, used throughout prod main.tf) and `//`. Block comments are deliberately
 * NOT stripped: the IAM policies contain the string literal
 * `"${aws_dynamodb_table.<x>.arn}/index/*"`, whose `/*` would be mistaken for a
 * block-comment open and swallow the rest of the file. The `//` stripper is
 * spared when preceded by `:` so an `arn:...` or `wss://` literal is never
 * truncated. This repo's Terraform uses `#` comments, so dropping block-comment
 * handling loses no real coverage.
 *
 * @param {string} text
 * @returns {string}
 */
export function stripHclComments(text) {
  const withoutHash = text.replace(/#[^\n]*/g, '')
  return withoutHash.replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

/**
 * Parse the canonical set of table-name env vars from dynamodb.ts: one
 * `requireEnv('<X>_TABLE', ...)` per `TableNames` accessor. This set defines
 * the closure scope: an env var NOT in it (e.g. CONNECTIONS_TABLE, which is a
 * websocket-connections table read elsewhere, not a TableNames accessor) is out
 * of scope and never checked.
 *
 * @param {string} dynamodbTsText
 * @returns {string[]} sorted unique `*_TABLE` env var names
 */
export function parseTableEnvVars(dynamodbTsText) {
  const code = stripHclComments(dynamodbTsText)
  const keys = new Set()
  for (const match of code.matchAll(/requireEnv\(\s*'([A-Z0-9_]+_TABLE)'/g)) {
    keys.add(match[1])
  }
  return [...keys].sort()
}

/**
 * Map a table env var to its Terraform table resource name. The prefix (env var
 * minus the `_TABLE` suffix), lowercased, equals the `aws_dynamodb_table.<x>`
 * resource name in every case: USERS_TABLE -> users, APP_DATA_TABLE -> app_data,
 * MUSIC_SCHEDULES_TABLE -> music_schedules, PRESENCE_TABLE -> presence.
 *
 * @param {string} envVar
 * @returns {string}
 */
export function envVarToTableKey(envVar) {
  return envVar.replace(/_TABLE$/, '').toLowerCase()
}

/**
 * Return the substring of `text` inside the block whose opening `{` is at
 * `openIndex`, using brace matching (so nested `{ }` in jsonencode / env blocks
 * are handled). Returns the inner text (between the braces), or '' if no match.
 *
 * @param {string} text
 * @param {number} openIndex index of the opening `{`
 * @returns {string}
 */
function sliceBraceBlock(text, openIndex) {
  let depth = 0
  for (let i = openIndex; i < text.length; i++) {
    const ch = text[i]
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return text.slice(openIndex + 1, i)
    }
  }
  return ''
}

/**
 * Parse declared DynamoDB table resource names from the Terraform text.
 *
 * @param {string} tfText
 * @returns {string[]} sorted unique table resource names
 */
export function parseDeclaredTables(tfText) {
  const code = stripHclComments(tfText)
  const tables = new Set()
  for (const match of code.matchAll(/resource\s+"aws_dynamodb_table"\s+"([a-z0-9_]+)"/g)) {
    tables.add(match[1])
  }
  return [...tables].sort()
}

/**
 * Parse, per Lambda, the set of `*_TABLE` env vars it SETS in its
 * `module "lambda_*"` environment_variables block. Keys are the lambda name
 * with the `lambda_` module prefix stripped (api, pulse_decay,
 * schedule_transition_tick, ...). All `*_TABLE` vars are captured here; the
 * closure computation later intersects with the canonical TableNames set, so
 * out-of-scope vars (CONNECTIONS_TABLE) are ignored without special-casing.
 *
 * @param {string} tfText
 * @returns {Record<string, string[]>} lambda -> sorted unique table env vars
 */
export function parseLambdaTableEnv(tfText) {
  const code = stripHclComments(tfText)
  const result = {}
  const moduleRe = /module\s+"lambda_([a-z0-9_]+)"\s*\{/g
  let m
  while ((m = moduleRe.exec(code)) !== null) {
    const lambda = m[1]
    const openIndex = code.indexOf('{', m.index + m[0].length - 1)
    const moduleBody = sliceBraceBlock(code, openIndex)
    const envMatch = /environment_variables\s*=\s*\{/.exec(moduleBody)
    const envVars = new Set()
    if (envMatch) {
      const envOpen = moduleBody.indexOf('{', envMatch.index + envMatch[0].length - 1)
      const envBody = sliceBraceBlock(moduleBody, envOpen)
      for (const em of envBody.matchAll(/^[ \t]*([A-Z][A-Z0-9_]*_TABLE)\s*=/gm)) {
        envVars.add(em[1])
      }
    }
    result[lambda] = [...envVars].sort()
  }
  return result
}

/**
 * Parse, per Lambda, the DynamoDB tables its IAM effectively grants, split into
 * base-table coverage and `/index/*` coverage. Walks every
 * `aws_iam_role_policy` block: the target Lambda(s) come from every
 * `module.lambda_<x>.role_name` reference in the block (this captures both a
 * direct `role = module.lambda_x.role_name` and the shared policy's `for_each`
 * map whose values are role names), and the granted tables come from every
 * `aws_dynamodb_table.<key>.arn` reference (a plain `.arn` is base coverage; an
 * `.arn}/index/*` interpolation is index coverage). Non-DynamoDB policies
 * (sqs/ses/cognito/execute-api) contribute no table keys.
 *
 * @param {string} tfText
 * @returns {Record<string, { base: string[], index: string[] }>}
 */
export function parseDynamodbIam(tfText) {
  const code = stripHclComments(tfText)
  const byLambda = {}
  const ensure = (lambda) => {
    if (!byLambda[lambda]) byLambda[lambda] = { base: new Set(), index: new Set() }
    return byLambda[lambda]
  }

  const polRe = /resource\s+"aws_iam_role_policy"\s+"[a-z0-9_]+"\s*\{/g
  let m
  while ((m = polRe.exec(code)) !== null) {
    const openIndex = code.indexOf('{', m.index + m[0].length - 1)
    const body = sliceBraceBlock(code, openIndex)

    const lambdas = new Set()
    for (const lm of body.matchAll(/module\.lambda_([a-z0-9_]+)\.role_name/g)) {
      lambdas.add(lm[1])
    }
    if (lambdas.size === 0) continue

    const indexKeys = new Set()
    for (const im of body.matchAll(/aws_dynamodb_table\.([a-z0-9_]+)\.arn\}\/index/g)) {
      indexKeys.add(im[1])
    }
    const baseKeys = new Set()
    for (const bm of body.matchAll(/aws_dynamodb_table\.([a-z0-9_]+)\.arn(?!\}\/index)/g)) {
      baseKeys.add(bm[1])
    }

    for (const lambda of lambdas) {
      const entry = ensure(lambda)
      for (const k of baseKeys) entry.base.add(k)
      for (const k of indexKeys) entry.index.add(k)
    }
  }

  const out = {}
  for (const [lambda, sets] of Object.entries(byLambda)) {
    out[lambda] = { base: [...sets.base].sort(), index: [...sets.index].sort() }
  }
  return out
}

/**
 * The pure closure computation. For every table env var a Lambda sets (limited
 * to the canonical TableNames set), assert the table resolves to a declared
 * resource and the Lambda's IAM grants both the base table and its indexes.
 * Broad-IAM-narrow-env asymmetries are reported separately (accepted vs
 * unexpected per the allowlist) and never counted as gaps.
 *
 * @param {{
 *   tableEnvVars: string[],
 *   envByLambda: Record<string, string[]>,
 *   iamByLambda: Record<string, { base: string[], index: string[] }>,
 *   declaredTables: string[],
 *   broadIamAllowlist?: Map<string, string>,
 * }} input
 * @returns {{
 *   rows: Array<{ lambda: string, envTables: string[], iamBase: string[], ok: boolean }>,
 *   missingIam: Array<{ lambda: string, table: string, envVar: string }>,
 *   missingIndex: Array<{ lambda: string, table: string, envVar: string }>,
 *   unknownTable: Array<{ lambda: string, table: string, envVar: string }>,
 *   acceptedAsymmetries: Array<{ lambda: string, extraTables: string[], reason: string }>,
 *   unexpectedAsymmetries: Array<{ lambda: string, extraTables: string[] }>,
 * }}
 */
export function computeClosure({
  tableEnvVars,
  envByLambda,
  iamByLambda,
  declaredTables,
  broadIamAllowlist = new Map(),
}) {
  const canonical = new Set(tableEnvVars)
  const declared = new Set(declaredTables)

  const rows = []
  const missingIam = []
  const missingIndex = []
  const unknownTable = []
  const acceptedAsymmetries = []
  const unexpectedAsymmetries = []

  for (const lambda of Object.keys(envByLambda).sort()) {
    const setVars = envByLambda[lambda].filter((v) => canonical.has(v))
    const iam = iamByLambda[lambda] || { base: [], index: [] }
    const iamBase = new Set(iam.base)
    const iamIndex = new Set(iam.index)

    const envTableKeys = setVars.map(envVarToTableKey).sort()
    let rowOk = true

    for (const envVar of setVars) {
      const table = envVarToTableKey(envVar)
      if (!declared.has(table)) {
        unknownTable.push({ lambda, table, envVar })
        rowOk = false
        continue
      }
      if (!iamBase.has(table)) {
        missingIam.push({ lambda, table, envVar })
        rowOk = false
        continue
      }
      if (!iamIndex.has(table)) {
        missingIndex.push({ lambda, table, envVar })
        rowOk = false
      }
    }

    rows.push({ lambda, envTables: envTableKeys, iamBase: [...iamBase].sort(), ok: rowOk })

    // Broad-IAM-narrow-env: tables the Lambda is granted but does not set as an
    // env var. Harmless (never a gap); annotated via the allowlist.
    const extraTables = [...iamBase].filter((t) => !envTableKeys.includes(t) && declared.has(t)).sort()
    if (extraTables.length > 0) {
      if (broadIamAllowlist.has(lambda)) {
        acceptedAsymmetries.push({ lambda, extraTables, reason: broadIamAllowlist.get(lambda) })
      } else {
        unexpectedAsymmetries.push({ lambda, extraTables })
      }
    }
  }

  return { rows, missingIam, missingIndex, unknownTable, acceptedAsymmetries, unexpectedAsymmetries }
}

function main() {
  let dynamodbTs
  let tf
  try {
    dynamodbTs = readFileSync(DYNAMODB_TS_PATH, 'utf8')
  } catch (err) {
    console.error(`[table-closure] Could not read ${relative(REPO_ROOT, DYNAMODB_TS_PATH)}.`)
    console.error(String(err))
    process.exit(1)
  }
  try {
    tf = readFileSync(PROD_TF_PATH, 'utf8')
  } catch (err) {
    console.error(`[table-closure] Could not read ${relative(REPO_ROOT, PROD_TF_PATH)}.`)
    console.error(String(err))
    process.exit(1)
  }

  const tableEnvVars = parseTableEnvVars(dynamodbTs)
  const declaredTables = parseDeclaredTables(tf)
  const envByLambda = parseLambdaTableEnv(tf)
  const iamByLambda = parseDynamodbIam(tf)

  const {
    rows,
    missingIam,
    missingIndex,
    unknownTable,
    acceptedAsymmetries,
    unexpectedAsymmetries,
  } = computeClosure({
    tableEnvVars,
    envByLambda,
    iamByLambda,
    declaredTables,
    broadIamAllowlist: BROAD_IAM_ALLOWLIST,
  })

  console.log(`[table-closure] TableNames env vars (backend/src/shared/db/dynamodb.ts): ${tableEnvVars.length}`)
  console.log(`[table-closure] Declared DynamoDB tables (prod main.tf): ${declaredTables.length}`)
  console.log(`[table-closure] Lambdas parsed: ${rows.length}`)
  console.log('[table-closure] Matrix (env tables a Lambda sets -> must be covered by its DynamoDB IAM):')
  for (const row of rows) {
    const mark = row.ok ? 'ok ' : 'x  '
    const env = row.envTables.length > 0 ? row.envTables.join(', ') : '(none)'
    console.log(`  ${mark}${row.lambda}: sets [${env}]`)
  }

  if (acceptedAsymmetries.length > 0) {
    console.log('[table-closure] Accepted broad-IAM / narrow-env asymmetries (allowlisted, not a gap):')
    for (const a of acceptedAsymmetries) {
      console.log(`  - ${a.lambda}: IAM also grants [${a.extraTables.join(', ')}]: ${a.reason}`)
    }
  }

  if (unexpectedAsymmetries.length > 0) {
    console.log('[table-closure] NOTE: broad-IAM / narrow-env asymmetry with no allowlist entry (drift, not a failure):')
    for (const a of unexpectedAsymmetries) {
      console.log(`  ~ ${a.lambda}: IAM grants [${a.extraTables.join(', ')}] beyond the table env vars it sets`)
    }
    console.log('[table-closure] If intended, add each to BROAD_IAM_ALLOWLIST with a reason.')
  }

  const gaps = missingIam.length + missingIndex.length + unknownTable.length
  if (gaps > 0) {
    console.error(`[table-closure] FAIL: ${gaps} Table_Closure gap(s): a Lambda sets a table env var its IAM does not cover:`)
    for (const g of unknownTable) {
      console.error(`  x ${g.lambda}: env ${g.envVar} -> no aws_dynamodb_table.${g.table} resource declared`)
    }
    for (const g of missingIam) {
      console.error(`  x ${g.lambda}: sets ${g.envVar} but IAM does not grant aws_dynamodb_table.${g.table}.arn`)
    }
    for (const g of missingIndex) {
      console.error(`  x ${g.lambda}: sets ${g.envVar} but IAM does not grant aws_dynamodb_table.${g.table}.arn/index/*`)
    }
    console.error('[table-closure] Add the table (and its /index/*) to that Lambda\'s DynamoDB IAM policy.')
    process.exit(1)
  }

  console.log('[table-closure] PASS: every table env var a Lambda sets is covered by its DynamoDB IAM (table + indexes).')
}

// CLI entry only when invoked directly, so the unit test can import the pure
// functions without triggering a filesystem read or process.exit.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main()
}
