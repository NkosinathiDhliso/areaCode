import { useTranslation } from 'react-i18next'

const STEP_KEYS = ['biz.live.step1', 'biz.live.step2', 'biz.live.step3', 'biz.live.step4'] as const

/**
 * What to do first, shown on the Live panel while a venue has almost no
 * check-ins. Its own file so the panel stays inside the component size limit;
 * the copy keys are unchanged.
 */
export function LiveZeroState() {
  const { t } = useTranslation()

  return (
    <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-5">
      <h3 className="text-[var(--text-primary)] font-medium mb-3">{t('biz.live.zeroState')}</h3>
      <ul className="flex flex-col gap-2 text-[var(--text-secondary)] text-sm">
        {STEP_KEYS.map((key, i) => (
          <li key={key} className="flex flex-row items-center gap-2">
            <span className="w-5 h-5 rounded-full bg-[var(--bg-raised)] flex items-center justify-center text-xs">
              {i + 1}
            </span>
            {t(key)}
          </li>
        ))}
      </ul>
    </div>
  )
}
