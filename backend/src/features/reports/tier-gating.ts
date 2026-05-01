import type { Report, TeaserReport } from './types.js'

/** Tiers that receive full detailed reports */
const FULL_ACCESS_TIERS = new Set(['growth', 'pro'])

/** Upgrade message shown to lower-tier businesses */
const UPGRADE_MESSAGE =
  'Upgrade to Growth for detailed breakdowns including peak hours, crowd composition, music profiles, competitive benchmarks, and more.'

/**
 * Filter a report based on the business's subscription tier.
 *
 * - growth / pro → full report with all sections
 * - starter / payg / free / unknown → teaser with summary only + upgrade CTA
 */
export function filterByTier(report: Report, tier: string): Report | TeaserReport {
  if (FULL_ACCESS_TIERS.has(tier)) {
    return report
  }

  return {
    reportId: report.reportId,
    businessId: report.businessId,
    schemaVersion: report.schemaVersion,
    periodType: report.periodType,
    periodStart: report.periodStart,
    periodEnd: report.periodEnd,
    generatedAt: report.generatedAt,
    summary: report.summary,
    upgradeMessage: UPGRADE_MESSAGE,
  }
}
