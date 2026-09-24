import { useTranslation } from 'react-i18next'

/* ------------------------------------------------------------------ */
/*  Reach_Card: the owner-facing value proposition (R10.6).            */
/*                                                                     */
/*  The one surface that answers "how does someone who has never been   */
/*  in find me". Reach is described as the four mechanisms that exist:   */
/*  the map, Tonight on the venue card, WhatsApp shares, and friends.    */
/*                                                                     */
/*  Every sentence lives in `apps/business/src/i18n/locales/en.json`     */
/*  under `biz.marketing.*`, one home, so the honest-copy property test   */
/*  (`backend/src/features/reports/__tests__/digest-copy.property.test.ts`) */
/*  has one surface to quantify over. No causal verbs, no money claims,   */
/*  no named venue to compare against. Do not inline copy here.           */
/* ------------------------------------------------------------------ */

/** The reach mechanisms, in the order the owner reads them. */
const REACH_KEYS = [
  'biz.marketing.reach.map',
  'biz.marketing.reach.tonight',
  'biz.marketing.reach.shares',
  'biz.marketing.reach.friends',
] as const

export function ReachCard() {
  const { t } = useTranslation()

  return (
    <section
      data-testid="reach-card"
      className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-5 flex flex-col gap-2"
    >
      <h3 className="text-[var(--text-primary)] font-bold text-sm font-[Syne]">{t('biz.marketing.reach.title')}</h3>
      <p className="text-[var(--text-secondary)] text-sm">{t('biz.marketing.reach.intro')}</p>
      <ul className="flex flex-col gap-2 mt-1">
        {REACH_KEYS.map((key) => (
          <li key={key} className="text-[var(--text-secondary)] text-sm">
            {t(key)}
          </li>
        ))}
      </ul>
      <p className="text-[var(--text-muted)] text-xs mt-1">{t('biz.marketing.reach.measured')}</p>
    </section>
  )
}
