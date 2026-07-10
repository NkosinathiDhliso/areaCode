/**
 * API region latency probe (audit-gap-closure R7.4).
 *
 * Measures round-trip latency from wherever this runs to:
 *   1. the live us-east-1 API health endpoint (https://api.areacode.co.za/health)
 *   2. a public af-south-1 (Cape Town) AWS endpoint, for a same-network-path
 *      comparison of the two regions.
 *
 * The decision in docs/decisions/api-region.md needs the numbers measured from a
 * South African vantage point. Run this from a SA network (a laptop on a local
 * ISP, or a small af-south-1-adjacent shell) and paste the printed table into
 * that record. Running it from anywhere else measures that vantage point, not
 * SA, so the output labels the host it ran on. Be honest about where it ran.
 *
 * Dependency-free: Node 18+ global fetch and node:perf_hooks only. No install.
 *
 * Usage (from repo root):
 *   node scripts/region-latency-probe.mjs
 *
 * Environment variables (all optional):
 *   PROBE_SAMPLES     Number of timed requests per target. Default 10.
 *   PROBE_TIMEOUT_MS  Per-request timeout in milliseconds. Default 5000.
 *   USEAST_URL        Override the us-east-1 target. Default the prod health URL.
 *   AFSOUTH_URL       Override the af-south-1 target. Default the af-south-1 S3
 *                     regional endpoint (a public AWS endpoint that terminates
 *                     in Cape Town, so RTT reflects the region, not the app).
 *
 * The two default targets are different services (the app vs raw S3), so treat
 * the comparison as region-to-region network RTT, not endpoint-to-endpoint app
 * latency. What matters for the decision is the gap between the two regions from
 * SA, and that gap is dominated by geographic distance, not the service.
 */

import os from 'node:os'
import { performance } from 'node:perf_hooks'

const SAMPLES = Number(process.env.PROBE_SAMPLES ?? 10)
const TIMEOUT_MS = Number(process.env.PROBE_TIMEOUT_MS ?? 5000)

const TARGETS = [
  {
    region: 'us-east-1',
    label: 'prod API health (us-east-1)',
    url: process.env.USEAST_URL ?? 'https://api.areacode.co.za/health',
  },
  {
    region: 'af-south-1',
    label: 'S3 regional endpoint (af-south-1)',
    url: process.env.AFSOUTH_URL ?? 'https://s3.af-south-1.amazonaws.com/',
  },
]

/**
 * One timed request. Returns the round-trip milliseconds, or null on failure
 * (timeout, DNS, connection reset). A null is reported honestly, never as 0.
 */
async function timeOnce(url) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  const start = performance.now()
  try {
    // HEAD keeps the payload out of the measurement; any HTTP status counts as
    // a reachable round trip (we are timing the network, not the response body).
    await fetch(url, { method: 'HEAD', signal: controller.signal })
    return performance.now() - start
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

function percentile(sortedMs, p) {
  if (sortedMs.length === 0) return null
  const idx = Math.min(sortedMs.length - 1, Math.floor((p / 100) * sortedMs.length))
  return sortedMs[idx]
}

function summarize(samples) {
  const ok = samples.filter((ms) => ms !== null).sort((a, b) => a - b)
  const failures = samples.length - ok.length
  if (ok.length === 0) return { failures, min: null, median: null, p95: null, max: null }
  const sum = ok.reduce((a, b) => a + b, 0)
  return {
    failures,
    min: ok[0],
    mean: sum / ok.length,
    median: percentile(ok, 50),
    p95: percentile(ok, 95),
    max: ok[ok.length - 1],
  }
}

const fmt = (ms) => (ms === null ? '  n/a' : `${ms.toFixed(0)}ms`)

async function main() {
  console.log('API region latency probe (audit-gap-closure R7.4)')
  console.log(`Vantage point: host ${os.hostname()}, platform ${os.platform()}`)
  console.log('WARNING: this measures the network this process runs on. For the')
  console.log('decision record, run it from a South African network.')
  console.log(`Samples per target: ${SAMPLES}, timeout ${TIMEOUT_MS}ms\n`)

  const rows = []
  for (const target of TARGETS) {
    // One warm-up request to prime DNS and TLS before the timed samples.
    await timeOnce(target.url)
    const samples = []
    for (let i = 0; i < SAMPLES; i++) samples.push(await timeOnce(target.url))
    const s = summarize(samples)
    rows.push({ target, s })
    console.log(
      `${target.region.padEnd(11)} ${target.label}\n` +
        `  url    ${target.url}\n` +
        `  min ${fmt(s.min)}  median ${fmt(s.median)}  p95 ${fmt(s.p95)}  ` +
        `max ${fmt(s.max)}  failures ${s.failures}/${SAMPLES}\n`
    )
  }

  const [a, b] = rows
  if (a?.s.median != null && b?.s.median != null) {
    const gap = a.s.median - b.s.median
    const nearer = gap > 0 ? b.target.region : a.target.region
    console.log(
      `Median gap: ${Math.abs(gap).toFixed(0)}ms (${nearer} is nearer from this vantage point).`
    )
  }
}

main()
