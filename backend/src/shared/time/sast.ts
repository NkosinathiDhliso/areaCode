/**
 * SAST day arithmetic, backend entry point.
 *
 * The implementation lives in `packages/shared/lib/sast.ts` because the portals
 * need the same day boundary the server writes with: the business check-in
 * detail partition is keyed by the SAST calendar date (R15.8, R15.12), so a panel
 * that defaults "today" to the UTC date asks for the wrong partition for the two
 * hours after midnight SAST. One implementation, two runtimes.
 *
 * This file stays as the backend's import path (`features/business/repository.ts`,
 * `features/check-in/service.ts`, `features/nodes/going.ts`,
 * `features/reports/digest.ts`, `features/reports/anonymize.ts`,
 * `features/presence/dwell-sink.ts` all read it from here). Add helpers to the
 * shared module, not to a second copy here.
 */
export {
  SAST_OFFSET_MS,
  SAST_TIME_ZONE,
  NIGHT_ROLLOVER_HOUR_SAST,
  instantMs,
  nightFor,
  sastDateString,
  startOfSastDayIso,
  secondsUntilNextSastMidnight,
  formatSastDate,
  formatSastLongDate,
  formatSastDayMonth,
  formatSastTime,
  formatSastDateTime,
  type Instant,
} from '@area-code/shared/lib/sast'
