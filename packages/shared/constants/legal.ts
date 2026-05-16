/**
 * Canonical commitments that appear in user-facing copy and the Terms of
 * Service simultaneously. Imported from both surfaces so the wording can
 * never drift between them.
 *
 * Updates here should be reviewed against the churn-defences spec
 * (.kiro/specs/churn-defences/requirements.md, Requirement 3) before
 * merging. The tier-permanence clause may only be strengthened — never
 * weakened — in subsequent revisions. See `docs/CHURN_DEFENSES.md` §1.2
 * for the rationale.
 */

export const TIER_PERMANENCE_CLAUSE =
  'Your tier and accumulated visit count are permanent. Area Code commits never to reset, downgrade, or annualise tier or visit count.'

export const TIER_PERMANENCE_SHORT = 'Your tier never expires.'

export const REWARD_EXPIRY_NOTICE = 'Your tier never expires. Specific Gets may have end dates set by the venue.'

/**
 * Identifier used to gate consent records. Bump alongside the consent
 * version env var when these clauses change. Kept in code, not env, so
 * a deploy is required to change them.
 */
export const LEGAL_CLAUSES_VERSION = '2026.05.1'
