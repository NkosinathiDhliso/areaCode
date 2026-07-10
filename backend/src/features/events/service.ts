import type { UsageEventName } from '@area-code/shared/constants/usage-events'

import type { UsageEventInput } from './types.js'

// CloudWatch Embedded Metric Format (EMF) constants. A structured JSON log line
// carrying the `_aws` block is auto-parsed by CloudWatch Logs into metrics, so
// we get "counts per event name per day" with no PutMetricData API call and no
// new always-on infrastructure or third-party vendor (R4.4, serverless-only).
const METRIC_NAMESPACE = 'AreaCode/Usage'
const METRIC_NAME = 'Count'
// `event` is the ONLY dimension. Session id and props are deliberately excluded
// so metric cardinality stays low and no PII becomes a dimension (R4.3, POPIA).
const METRIC_DIMENSION = 'event'

/**
 * One EMF log line. Shape is fixed by the CloudWatch EMF spec: the `_aws` block
 * declares the namespace, dimension set, and metric; the sibling fields supply
 * the dimension value (`event`) and the metric value (`Count`).
 */
interface EmfMetricLine {
  _aws: {
    Timestamp: number
    CloudWatchMetrics: Array<{
      Namespace: string
      Dimensions: string[][]
      Metrics: Array<{ Name: string; Unit: string }>
    }>
  }
  event: UsageEventName
  Count: number
}

function buildEmfLine(event: UsageEventName, count: number, timestamp: number): EmfMetricLine {
  return {
    _aws: {
      Timestamp: timestamp,
      CloudWatchMetrics: [
        {
          Namespace: METRIC_NAMESPACE,
          Dimensions: [[METRIC_DIMENSION]],
          Metrics: [{ Name: METRIC_NAME, Unit: 'Count' }],
        },
      ],
    },
    event,
    Count: count,
  }
}

/**
 * Aggregate a validated batch into one count per event name. The batch is
 * already allowlist-checked by the Zod schema, so every name here is a known
 * `UsageEventName`. Session id, timestamp, and props are dropped: they are never
 * persisted and never become metric dimensions (R4.3).
 */
export function aggregateCounts(events: UsageEventInput[]): Map<UsageEventName, number> {
  const counts = new Map<UsageEventName, number>()
  for (const event of events) {
    counts.set(event.name, (counts.get(event.name) ?? 0) + 1)
  }
  return counts
}

/**
 * Record a validated batch of usage events as CloudWatch EMF metrics. Emits one
 * EMF line per distinct event name (count aggregated across the batch). No
 * DynamoDB write, no external call: events are never persisted (R4.4, no new
 * table), only counted. The function is intentionally synchronous and total; it
 * cannot fail the request.
 */
export function recordEvents(events: UsageEventInput[]): void {
  const timestamp = Date.now()
  const counts = aggregateCounts(events)
  for (const [event, count] of counts) {
    // Structured EMF line: CloudWatch Logs parses it into a metric. This is the
    // one emit path (no PutMetricData, no vendor), matching the worker metric
    // convention in `workers/schedule-transition-tick.ts`.
    console.log(JSON.stringify(buildEmfLine(event, count, timestamp)))
  }
}
