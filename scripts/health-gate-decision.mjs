// Health_Gate decision rule (Release Quality and Ops Hygiene, R2).
//
// Pure, side-effect-free decision core for the post-deploy auto-rollback gate
// (.github/workflows/release-health-gate.yml). Extracted as a standalone ESM
// module so it can be property-tested in isolation (see the spec's Property 2).
//
// Signals it judges:
//   - RUM_Signal: per-monitor frontend error rate for the post-deploy window
//     vs the trailing 7-day baseline, for each of the four CloudWatch RUM
//     app monitors (web, business, staff, admin). Error rate is
//     JsErrorCount / SessionCount. RUM has no release/SHA concept, so the
//     "release" is the post-deploy timestamp window.
//   - Backend_Signal: the prod API Lambda error and p99 CloudWatch alarm
//     states. Any alarm in ALARM during the window is a rollback vote.
//
// Decision rule (the one this module owns):
//   vote ROLLBACK iff (a frontend monitor's window error rate regressed beyond
//   the threshold) OR (a backend alarm is in ALARM).
//
// Missing / unreadable data is NEVER a silent pass. It is a distinct outcome
// (MISSING_DATA) that the workflow surfaces as a loud job failure (R2.4). This
// covers: an explicit collection-failure flag (a CloudWatch API call errored),
// structurally absent signal arrays, non-finite metric values, and an empty
// metric set (zero total sessions across every monitor, i.e. no RUM signal
// reaching CloudWatch at all).

/**
 * The three distinct, mutually exclusive gate outcomes.
 * @readonly
 */
export const HealthDecision = Object.freeze({
  ROLLBACK: 'ROLLBACK',
  NO_ROLLBACK: 'NO_ROLLBACK',
  MISSING_DATA: 'MISSING_DATA',
})

/**
 * Backend alarm states that count as a rollback vote. INSUFFICIENT_DATA and OK
 * do not vote; only a firing alarm does.
 */
const FIRING_ALARM_STATE = 'ALARM'

const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value)

/**
 * @typedef {Object} FrontendSignal
 * @property {string}  monitor          Logical monitor key (web|business|staff|admin).
 * @property {number}  windowErrorRate  JsErrorCount/SessionCount over the post-deploy window.
 * @property {number}  baselineErrorRate JsErrorCount/SessionCount over the trailing 7 days.
 * @property {number}  windowSessions   SessionCount over the post-deploy window.
 */

/**
 * @typedef {Object} BackendAlarm
 * @property {string} name  CloudWatch alarm name.
 * @property {string} state Current state: OK | ALARM | INSUFFICIENT_DATA.
 */

/**
 * @typedef {Object} HealthGateInput
 * @property {FrontendSignal[]} frontendSignals    Per-monitor RUM signals.
 * @property {BackendAlarm[]}   backendAlarms       Prod API Lambda alarms.
 * @property {boolean}          [hasMissingData]    Set true when any CloudWatch
 *                                                  read failed (API error).
 * @property {number}           [errorRateRegressionThreshold] Absolute increase
 *                                                  in error rate (window minus
 *                                                  baseline) that counts as a
 *                                                  regression. Default 0.05.
 * @property {number}           [minSessions]       Per-monitor session floor
 *                                                  below which a monitor cannot
 *                                                  cast a frontend regression
 *                                                  vote (low-traffic guard).
 *                                                  Default 30.
 */

/**
 * @typedef {Object} HealthGateResult
 * @property {string}   decision  One of HealthDecision.
 * @property {string[]} reasons   Machine-readable reason codes for the summary.
 */

/**
 * Evaluate the release health signals and return a rollback decision.
 *
 * Pure: depends only on its argument, mutates nothing, returns the same output
 * for the same input.
 *
 * @param {HealthGateInput} input
 * @returns {HealthGateResult}
 */
export function evaluateHealthGate(input) {
  const {
    frontendSignals,
    backendAlarms,
    hasMissingData = false,
    errorRateRegressionThreshold = 0.05,
    minSessions = 30,
  } = input ?? {}

  // 1. Explicit collection failure (a CloudWatch API call errored upstream).
  if (hasMissingData) {
    return { decision: HealthDecision.MISSING_DATA, reasons: ['collection_failed'] }
  }

  // 2. Structurally absent signal sets. A gate with no signals cannot pass.
  if (!Array.isArray(frontendSignals) || frontendSignals.length === 0) {
    return { decision: HealthDecision.MISSING_DATA, reasons: ['no_frontend_signals'] }
  }
  if (!Array.isArray(backendAlarms)) {
    return { decision: HealthDecision.MISSING_DATA, reasons: ['no_backend_signals'] }
  }

  // 3. Non-finite metric values mean a monitor's data could not be read.
  for (const signal of frontendSignals) {
    if (
      !signal ||
      !isFiniteNumber(signal.windowErrorRate) ||
      !isFiniteNumber(signal.baselineErrorRate) ||
      !isFiniteNumber(signal.windowSessions) ||
      signal.windowSessions < 0
    ) {
      return { decision: HealthDecision.MISSING_DATA, reasons: ['unreadable_metric'] }
    }
  }

  // 4. Empty metric set: zero sessions across every monitor means no RUM signal
  //    is reaching CloudWatch. That is the exact blind-gate failure this spec
  //    exists to prevent, so it fails loudly rather than passing silently.
  const totalWindowSessions = frontendSignals.reduce((sum, s) => sum + s.windowSessions, 0)
  if (totalWindowSessions <= 0) {
    return { decision: HealthDecision.MISSING_DATA, reasons: ['empty_metric_set'] }
  }

  const reasons = []

  // Backend vote: any firing alarm during the window.
  for (const alarm of backendAlarms) {
    if (alarm && alarm.state === FIRING_ALARM_STATE) {
      reasons.push(`backend_alarm:${alarm.name ?? 'unknown'}`)
    }
  }

  // Frontend vote: a monitor with enough traffic whose window error rate
  // regressed beyond the threshold versus its own baseline. Monitors below the
  // session floor cannot vote (avoids low-traffic false positives) but their
  // presence still proves the signal is live, so they are not missing data.
  for (const signal of frontendSignals) {
    if (signal.windowSessions < minSessions) continue
    if (signal.windowErrorRate - signal.baselineErrorRate > errorRateRegressionThreshold) {
      reasons.push(`frontend_regression:${signal.monitor}`)
    }
  }

  if (reasons.length > 0) {
    return { decision: HealthDecision.ROLLBACK, reasons }
  }
  return { decision: HealthDecision.NO_ROLLBACK, reasons: ['healthy'] }
}

// CLI entry: read the collected signals JSON from argv[2] (a file path) or
// stdin, print the decision as JSON, and exit non-zero on MISSING_DATA so the
// workflow step fails loudly. Kept thin; all logic lives in evaluateHealthGate.
const isMain = import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('health-gate-decision.mjs')

if (isMain) {
  const { readFileSync } = await import('node:fs')
  const source = process.argv[2] ? readFileSync(process.argv[2], 'utf8') : readFileSync(0, 'utf8')
  const result = evaluateHealthGate(JSON.parse(source.replace(/^\uFEFF/, '')))
  process.stdout.write(JSON.stringify(result) + '\n')
  if (result.decision === HealthDecision.MISSING_DATA) {
    process.exitCode = 1
  }
}
