// Dwell aggregate sink for Presence Integrity.
//
// On every successful Presence_Record end (manual check-out or serverless
// expiry) an anonymised dwell row is written to the `app-data` table so dwell
// time can later be aggregated per venue and per time band into sellable venue
// intelligence (Requirement 12).
//
// The row is deliberately ANONYMISED: it carries the venue, the dwell duration,
// how the record ended, the SAST time band, when it ended, and a retention TTL.
// It carries NO `userId`, `cognitoSub`, `displayName`, `email`, `phone`,
// `avatarUrl`, latitude, or longitude. The at-most-once guarantee for dwell
// lives on the Presence_Record's conditional transition, so the aggregate row
// needs no consumer reference at all. (Requirements 9.4, 9.5, 10.3)
//
// The `<yyyy-mm-dd>` partition date and the `peak`/`off_peak` time band are both
// computed in SAST (UTC+2), reusing the exact `isPeakHour` boundary from the
// pulse-decay worker so dwell binning stays coherent with the other aliveness
// signals (consistent with `window.ts`).
import { PutCommand } from '@aws-sdk/lib-dynamodb'

import { documentClient, TableNames } from '../../shared/db/dynamodb.js'
import { generateId } from '../../shared/db/entities.js'
import { isPeakHour } from '../../workers/pulse-decay.js'
import type { DwellRow, DwellTermination } from '../check-out/types.js'

/**
 * Retention horizon for raw dwell rows (365 days, in seconds). Raw rows are
 * kept long enough for period-over-period business aggregation, then physically
 * cleaned up by DynamoDB TTL. Aggregation reads these rows; it never depends on
 * TTL deletion timing.
 */
const DWELL_ROW_TTL_SECONDS = 365 * 24 * 60 * 60

/** Milliseconds offset for SAST (UTC+2). */
const SAST_OFFSET_MS = 2 * 60 * 60 * 1000

/**
 * Input for a single dwell-row write. These are exactly the facts a record end
 * produces — nothing identity-bearing. `timeBand` and the partition date are
 * derived internally from `endedAt` so callers cannot accidentally bin a row
 * into the wrong band.
 */
export interface WriteDwellRowInput {
  /** Venue the dwell is attributed to. */
  nodeId: string
  /** Whole-second dwell duration; clamped to a non-negative integer. */
  durationSeconds: number
  /** Whether the record ended by manual check-out or by expiry. */
  termination: DwellTermination
  /** Epoch seconds at which the record ended (check-out time, or `expiresAt` on expiry). */
  endedAt: number
}

/**
 * Compute the SAST (UTC+2) calendar date as `yyyy-mm-dd` for an epoch-seconds
 * instant. Shifting the instant by +2h and reading the UTC date parts yields the
 * civil date in South Africa without pulling in a timezone library.
 */
function sastDateString(endedAtEpochSeconds: number): string {
  const sast = new Date(endedAtEpochSeconds * 1000 + SAST_OFFSET_MS)
  const year = sast.getUTCFullYear()
  const month = String(sast.getUTCMonth() + 1).padStart(2, '0')
  const day = String(sast.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * Persist one anonymised dwell aggregate row to the `app-data` table
 * (`PAY_PER_REQUEST`). Called by the check-out service and the presence-expiry
 * worker on every successful record end.
 *
 * Key structure (per the design Data Models — Dwell aggregate row):
 *   pk = DWELL#<nodeId>#<yyyy-mm-dd>     (partition per venue per SAST day)
 *   sk = DWELL#<endedAtEpoch>#<recordId> (unique per row, time-ordered)
 *
 * @returns the row that was written, useful for assertions/tests.
 */
export async function writeDwellRow(input: WriteDwellRowInput): Promise<DwellRow> {
  // Guard: dwell is always a non-negative integer number of seconds (Requirement 9.3).
  const durationSeconds = Math.max(0, Math.floor(input.durationSeconds))
  const endedAt = Math.floor(input.endedAt)

  // SAST time band, reusing the single-source-of-truth peak boundary.
  const timeBand: DwellRow['timeBand'] = isPeakHour(new Date(endedAt * 1000)) ? 'peak' : 'off_peak'

  const ttl = endedAt + DWELL_ROW_TTL_SECONDS

  const row: DwellRow = {
    nodeId: input.nodeId,
    durationSeconds,
    termination: input.termination,
    timeBand,
    endedAt,
    ttl,
  }

  const datePartition = sastDateString(endedAt)
  const recordId = generateId()

  await documentClient.send(
    new PutCommand({
      TableName: TableNames.appData,
      Item: {
        pk: `DWELL#${input.nodeId}#${datePartition}`,
        sk: `DWELL#${endedAt}#${recordId}`,
        // Anonymised attributes only — no userId/identity/coordinates.
        nodeId: row.nodeId,
        durationSeconds: row.durationSeconds,
        termination: row.termination,
        timeBand: row.timeBand,
        endedAt: row.endedAt,
        ttl: row.ttl,
      },
    }),
  )

  return row
}
