// Load smoke for the dev API (audit-gap-closure R6.2, R6.3).
//
// Exercises the consumer hot path against DEV ONLY: the city nodes read and a
// check-in burst. Manual trigger only (k6 run locally, or the workflow_dispatch
// job in .github/workflows/load-smoke.yml). Never wired to push or PR, to
// respect the dev budget.
//
// Run locally:
//   k6 run \
//     -e BASE_URL=https://<dev-api-host> \
//     -e K6_DEV_TOKEN=<consumer bearer JWT> \
//     -e CHECKIN_NODE_ID=<a dev node id> \
//     scripts/load-smoke.js
//
// Environment variables:
//   BASE_URL          (required) Dev API base, no trailing slash. No default:
//                     this must point at dev, never prod, so it is not guessed.
//   K6_DEV_TOKEN      (required for a meaningful check-in scenario) A consumer
//                     Cognito bearer token for the dev pool. Never hardcoded;
//                     supplied via env or a GitHub secret. Without it the
//                     check-in requests return 401 and the scenario honestly
//                     reports an unauthenticated result rather than faking one.
//   CHECKIN_NODE_ID   (required for the check-in scenario) The dev node id to
//                     check into. Without it the request is rejected by Zod
//                     validation (400), which is measured honestly.
//   CHECKIN_CITY      (optional) City slug for the nodes read. Default
//                     'johannesburg'.
//   CHECKIN_QR_TOKEN  (optional) A QR token for the node. On dev the check-in
//                     path is short-circuited to success, so this is not needed
//                     there; it is here for completeness.
//
// Thresholds (the run fails when breached):
//   http_req_duration p95 < 800ms on each scenario.
//   http_req_failed   rate < 1% on the public nodes read (it must return 200).
//   server_errors     rate < 1% overall (5xx or network/timeout only). Rate
//                     limit 429s and auth 401s are the server responding
//                     correctly under load, not faults, so they are not counted
//                     as errors. This keeps the check-in burst honest: the
//                     check-in route is rate limited to 10 requests per 60s per
//                     user, so a single-token burst is mostly 429 by design.

import { check } from 'k6'
import exec from 'k6/execution'
import http from 'k6/http'
import { Rate } from 'k6/metrics'

const BASE_URL = (__ENV.BASE_URL || '').replace(/\/+$/, '')
const DEV_TOKEN = __ENV.K6_DEV_TOKEN || ''
const CITY = __ENV.CHECKIN_CITY || 'johannesburg'
const NODE_ID = __ENV.CHECKIN_NODE_ID || ''
const QR_TOKEN = __ENV.CHECKIN_QR_TOKEN || ''

// Counts only genuine server faults: 5xx responses and network/timeout errors
// (status 0). Correct fail-closed responses (401, 429, 4xx validation) are not
// faults and are excluded, so the threshold measures real health under load.
const serverErrors = new Rate('server_errors')

export const options = {
  scenarios: {
    nodes_read: {
      executor: 'constant-arrival-rate',
      exec: 'nodesRead',
      rate: 50,
      timeUnit: '1s',
      duration: '2m',
      preAllocatedVUs: 50,
      maxVUs: 120,
    },
    checkin_burst: {
      executor: 'constant-arrival-rate',
      exec: 'checkinBurst',
      rate: 10,
      timeUnit: '1s',
      duration: '30s',
      preAllocatedVUs: 10,
      maxVUs: 30,
    },
  },
  thresholds: {
    'http_req_duration{scenario:nodes_read}': ['p(95)<800'],
    'http_req_duration{scenario:checkin_burst}': ['p(95)<800'],
    'http_req_failed{scenario:nodes_read}': ['rate<0.01'],
    server_errors: ['rate<0.01'],
  },
}

// Fail fast on misconfiguration rather than smoke-testing nothing.
export function setup() {
  if (!BASE_URL) {
    exec.test.abort('BASE_URL is required and must point at the dev API, never prod.')
  }
  if (!DEV_TOKEN) {
    console.warn(
      'K6_DEV_TOKEN is not set: check-in requests will return 401. Set it to exercise the authenticated write path.',
    )
  }
  if (!NODE_ID) {
    console.warn(
      'CHECKIN_NODE_ID is not set: check-in requests will fail Zod validation (400). Set it to a dev node id.',
    )
  }
  return { baseUrl: BASE_URL }
}

function recordServerFault(res) {
  serverErrors.add(res.status === 0 || res.status >= 500)
}

export function nodesRead(data) {
  const res = http.get(`${data.baseUrl}/v1/nodes/${CITY}`, {
    tags: { name: 'nodes_read' },
  })
  recordServerFault(res)
  check(res, {
    'nodes read is 200': (r) => r.status === 200,
    'nodes read has nodes array': (r) => {
      try {
        return Array.isArray(r.json('nodes'))
      } catch {
        return false
      }
    },
  })
}

export function checkinBurst(data) {
  const headers = { 'Content-Type': 'application/json' }
  if (DEV_TOKEN) {
    headers['Authorization'] = `Bearer ${DEV_TOKEN}`
  }
  const body = { nodeId: NODE_ID, type: 'presence' }
  if (QR_TOKEN) {
    body.qrToken = QR_TOKEN
  }
  const res = http.post(`${data.baseUrl}/v1/check-in`, JSON.stringify(body), {
    headers,
    tags: { name: 'check_in' },
  })
  recordServerFault(res)
  // A correct response under load is any of: 200 (accepted, dev short-circuit),
  // 429 (rate limited, 10/60s per user), 401 (missing or expired token), or a
  // 4xx validation/proximity rejection. Only 5xx and network errors are faults.
  check(res, {
    'check-in did not server-error': (r) => r.status !== 0 && r.status < 500,
  })
}
