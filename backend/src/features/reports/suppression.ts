// The Suppression_Floor: one home for the minimum sample every derived number
// needs before an owner reads it.
//
// Feature: weekly-attribution-digest (R1.5), proof-of-demand (R4.8)
//
// It lives in its own module because both sides of the reporting layer need it
// and one of them now reads the other: `computeDigest` calls `computeReceipt`,
// so the constant cannot sit in `digest.ts` or `receipt.ts` without making the
// two files import each other. One definition, one import path, no cycle.

/**
 * Percentages and week-over-week comparisons require the underlying sample to
 * reach this many events. Absolute counts always render; anything derived from
 * a smaller sample is withheld rather than shown at low confidence. Matches the
 * reports anonymization posture (min sample of 5).
 */
export const SUPPRESSION_FLOOR = 5
