/**
 * SAST day arithmetic, the one home for every runtime.
 *
 * South Africa observes no daylight saving, so Southern African Standard Time is
 * a fixed UTC+2 all year. That lets a "day" be a fixed offset instead of a
 * timezone-library lookup, and it lets every helper here stay pure: the caller
 * supplies the instant, nothing reads the clock implicitly except the documented
 * default.
 *
 * This lives in `packages/shared/lib` rather than in the backend because the
 * portals need the same day boundary the server writes with: the business
 * check-in detail partition is keyed by the SAST calendar date
 * (proof-of-demand R15.8), so a panel that defaults "today" to the UTC date asks
 * for the wrong partition for the two hours after midnight SAST, exactly when a
 * venue is busiest. `backend/src/shared/time/sast.ts` re-exports this module, so
 * there is one implementation behind both the server and the client.
 *
 * `packages/shared/lib/scheduleResolver.ts` is the one deliberate exception: a
 * venue's schedule resolves through timezone-aware `Intl` there, not this fixed
 * offset. Leave that path alone.
 */

/** Fixed SAST offset (UTC+2, no DST). */
export const SAST_OFFSET_MS = 2 * 60 * 60 * 1000

const DAY_MS = 24 * 60 * 60 * 1000

/** An instant, however the caller happens to hold it. Numbers are epoch ms. */
export type Instant = Date | number | string

/** Epoch ms for an instant, throwing on an unparseable one rather than guessing. */
export function instantMs(instant: Instant): number {
  const ms = typeof instant === 'number' ? instant : new Date(instant).getTime()
  if (Number.isNaN(ms)) {
    throw new Error(`sast: invalid instant "${String(instant)}"`)
  }
  return ms
}

/**
 * The SAST calendar date (`YYYY-MM-DD`) an instant falls on.
 *
 * A South African owner's or consumer's "today" ends at midnight SAST, so every
 * day-keyed row and every day-scoped count uses this, never the UTC date, which
 * would move the boundary two hours into the next evening.
 */
export function sastDateString(instant: Instant = Date.now()): string {
  return new Date(instantMs(instant) + SAST_OFFSET_MS).toISOString().slice(0, 10)
}

/**
 * The hour (SAST) at which a night rolls over. This is the product's one
 * definition of a night, not one feature's local rule.
 *
 * A mark or a set at 01:30 on Saturday belongs to Friday's night, because that
 * is the night the person is out on. Four in the morning is past closing time
 * everywhere and before anyone is out again, so no real night is ever split by
 * it.
 *
 * It lives here because two definitions of a night was a real bug: Going keyed
 * its rows at this rollover while Tonight resolved on the calendar date, so at
 * 00:01 a consumer still held a Friday Going mark while Friday's headline had
 * already vanished from the map. One number, one answer
 * (`docs/decisions/proof-of-demand.md` decision 12).
 */
export const NIGHT_ROLLOVER_HOUR_SAST = 4

/**
 * The night an instant belongs to, as a SAST calendar date.
 *
 * Every instant in `[04:00 SAST, 04:00 SAST + 24h)` maps to the same night.
 * Going keys its rows with this; the Tonight resolution measures a dated slot's
 * hours from the same night's midnight.
 */
export function nightFor(instant: Instant = Date.now()): string {
  return sastDateString(instantMs(instant) - NIGHT_ROLLOVER_HOUR_SAST * 60 * 60 * 1000)
}

/**
 * The instant the SAST calendar day containing `instant` began, as a UTC ISO
 * string (00:00 SAST is 22:00 UTC the previous day).
 *
 * This is the lower bound of every "today" a South African owner or consumer
 * reads: same-day redemptions, the live panel's check-in count, the Receipt
 * window. A UTC day start would put the boundary at 02:00 SAST and split a
 * venue's busiest hours across two days.
 */
export function startOfSastDayIso(instant: Instant = Date.now()): string {
  const day = sastDateString(instant)
  return new Date(Date.parse(`${day}T00:00:00.000Z`) - SAST_OFFSET_MS).toISOString()
}

/**
 * Whole seconds from `instant` to the next 00:00 SAST, always in `(0, 86400]`.
 *
 * The TTL for anything that means "today": a day counter given this TTL stops
 * existing when the day does, instead of 24 hours after its first write, which
 * would have it citing yesterday's number the next morning. Exactly at midnight
 * the answer is a full day, never zero, so a counter written on the boundary
 * still covers the day it opens. Sub-second instants round up, so a key never
 * expires a fraction of a second early.
 */
export function secondsUntilNextSastMidnight(instant: Instant = Date.now()): number {
  const ms = instantMs(instant)
  const nextMidnightMs = Date.parse(startOfSastDayIso(ms)) + DAY_MS
  return Math.ceil((nextMidnightMs - ms) / 1000)
}
/**
 * The IANA zone every owner-facing and admin-facing date is rendered in.
 *
 * Owners and admins read a venue's clock, not their device's. A manager checking
 * the portal from a trip abroad must see the same redemption time the staff
 * member at the till saw, so display never falls back to the ambient timezone.
 */
export const SAST_TIME_ZONE = 'Africa/Johannesburg'

/** `en-ZA` parts for an instant, pinned to SAST whatever the device is set to. */
function formatInSast(instant: Instant, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat('en-ZA', { ...options, timeZone: SAST_TIME_ZONE }).format(new Date(instantMs(instant)))
}

/**
 * Day, short month, year in SAST: `09 Aug 2026`.
 *
 * The default date shape for owner and admin surfaces. A bare `YYYY-MM-DD`
 * (a SAST calendar date from the API) is safe to pass: it parses as UTC
 * midnight, which is 02:00 SAST on the same date.
 */
export function formatSastDate(instant: Instant): string {
  return formatInSast(instant, { day: 'numeric', month: 'short', year: 'numeric' })
}

/** Day, full month, year in SAST: `9 August 2026`. For billing copy in prose. */
export function formatSastLongDate(instant: Instant): string {
  return formatInSast(instant, { day: 'numeric', month: 'long', year: 'numeric' })
}

/** Day and short month in SAST: `09 Aug`. For compact labels with no year. */
export function formatSastDayMonth(instant: Instant): string {
  return formatInSast(instant, { day: '2-digit', month: 'short' })
}

/** 24-hour time in SAST: `18:00`. */
export function formatSastTime(instant: Instant): string {
  return formatInSast(instant, { hour: '2-digit', minute: '2-digit', hour12: false })
}

/** Date then time in SAST: `09 Aug 2026 18:00`. */
export function formatSastDateTime(instant: Instant): string {
  return `${formatSastDate(instant)} ${formatSastTime(instant)}`
}

/** A `<input type="datetime-local">` value: `YYYY-MM-DDTHH:mm`. */
const DATE_TIME_LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/

/**
 * SAST wall-clock value for a `datetime-local` input, `YYYY-MM-DDTHH:mm`.
 *
 * The browser renders and returns a `datetime-local` value in the device's
 * timezone with no offset attached, so seeding one from a local `Date` shows an
 * admin abroad a time the venue never sees. Seeding it from here means the field
 * always reads as the venue's clock.
 */
export function toSastDateTimeLocal(instant: Instant = Date.now()): string {
  return new Date(instantMs(instant) + SAST_OFFSET_MS).toISOString().slice(0, 16)
}

/**
 * Read a `datetime-local` value as SAST wall-clock and return the UTC ISO
 * instant, or `null` when the value is not a well-formed local date-time.
 *
 * Fails closed on a malformed value rather than guessing: an entitlement end
 * date parsed two hours out is a billing error, and `new Date(value)` would
 * silently interpret it in the device timezone.
 */
export function sastDateTimeLocalToIso(value: string): string | null {
  const wallClock = value.trim()
  if (!DATE_TIME_LOCAL_RE.test(wallClock)) return null
  const ms = Date.parse(`${wallClock}:00.000Z`)
  if (Number.isNaN(ms)) return null
  // `Date.parse` rolls an impossible date over (30 February becomes 2 March), so
  // confirm the parse round-trips to the wall clock it was given.
  if (new Date(ms).toISOString().slice(0, 16) !== wallClock) return null
  return new Date(ms - SAST_OFFSET_MS).toISOString()
}
