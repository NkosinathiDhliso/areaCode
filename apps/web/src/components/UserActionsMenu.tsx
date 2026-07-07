import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { MoreVertical } from 'lucide-react'
import { api } from '@area-code/shared/lib/api'
import { useErrorStore } from '@area-code/shared/stores/errorStore'
import { useMapStore } from '@area-code/shared/stores/mapStore'

type ReportCategory = 'harassment_report' | 'stalking' | 'spam' | 'inappropriate_content' | 'other'

const REPORT_CATEGORIES: ReportCategory[] = ['harassment_report', 'stalking', 'spam', 'inappropriate_content', 'other']

/**
 * Per-user moderation menu (block + report) for any surface that renders another
 * consumer: the Friends screen rows, search results, who-is-here, etc.
 *
 * Blocking severs the mutual-follow edges server-side, so on success we drop the
 * user from the local taste-match presence store immediately and refetch the
 * friend lists. Reporting posts to the abuse queue. Both are safety primitives
 * that app stores expect any social surface to expose.
 */
export function UserActionsMenu({
  targetUserId,
  targetName,
  onBlocked,
}: {
  targetUserId: string
  targetName: string
  /** Called after a successful block so a parent surface (e.g. a profile sheet) can close. */
  onBlocked?: () => void
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const removeFriendPresenceEverywhere = useMapStore((s) => s.removeFriendPresenceEverywhere)

  const [open, setOpen] = useState(false)
  const [showReport, setShowReport] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDocClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

  const invalidateSocial = () => {
    void queryClient.invalidateQueries({ queryKey: ['friends'] })
    void queryClient.invalidateQueries({ queryKey: ['following'] })
    void queryClient.invalidateQueries({ queryKey: ['followers'] })
    void queryClient.invalidateQueries({ queryKey: ['user-search'] })
  }

  const blockMutation = useMutation({
    mutationFn: () => api.post(`/v1/users/me/block/${targetUserId}`, {}),
    onSuccess: () => {
      removeFriendPresenceEverywhere(targetUserId)
      invalidateSocial()
      setOpen(false)
      onBlocked?.()
    },
    onError: () => {
      useErrorStore.getState().showError(t('friends.blockError', "Couldn't block. Try again."))
    },
  })

  return (
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        aria-label={t('friends.moreActions', 'More actions')}
        onClick={() => setOpen((v) => !v)}
        className="w-11 h-11 flex items-center justify-center text-[var(--text-secondary)] rounded-xl transition-all active:scale-95"
      >
        <MoreVertical size={18} />
      </button>

      {open && (
        <div className="absolute right-0 top-11 z-30 w-40 bg-[var(--bg-raised)] border border-[var(--border)] rounded-xl overflow-hidden shadow-lg">
          <button
            type="button"
            onClick={() => blockMutation.mutate()}
            disabled={blockMutation.isPending}
            className="w-full text-left px-4 py-3 text-sm text-[var(--danger)] transition-all active:scale-95"
          >
            {t('friends.block', 'Block')}
          </button>
          <button
            type="button"
            onClick={() => {
              setOpen(false)
              setShowReport(true)
            }}
            className="w-full text-left px-4 py-3 text-sm text-[var(--text-primary)] border-t border-[var(--border)] transition-all active:scale-95"
          >
            {t('friends.report', 'Report')}
          </button>
        </div>
      )}

      {showReport && (
        <ReportDialog targetUserId={targetUserId} targetName={targetName} onClose={() => setShowReport(false)} />
      )}
    </div>
  )
}

function ReportDialog({
  targetUserId,
  targetName,
  onClose,
}: {
  targetUserId: string
  targetName: string
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [category, setCategory] = useState<ReportCategory>('harassment_report')
  const [description, setDescription] = useState('')
  const [submitted, setSubmitted] = useState(false)

  const reportMutation = useMutation({
    mutationFn: () =>
      api.post('/v1/reports', { reportedUserId: targetUserId, category, description: description.trim() }),
    onSuccess: () => setSubmitted(true),
    onError: () => {
      useErrorStore.getState().showError(t('friends.reportError', "Couldn't submit report. Try again."))
    },
  })

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 px-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="w-full max-w-sm bg-[var(--bg-surface)] border border-[var(--border)] rounded-t-3xl sm:rounded-2xl p-5"
        style={{ paddingBottom: 'max(1.25rem, env(safe-area-inset-bottom))' }}
        onClick={(e) => e.stopPropagation()}
      >
        {submitted ? (
          <div className="flex flex-col items-center gap-3 py-4">
            <p className="text-[var(--text-primary)] text-sm text-center">
              {t('friends.reportSubmitted', 'Thanks. Our team will review this report.')}
            </p>
            <button
              onClick={onClose}
              className="text-sm text-white gradient-accent rounded-xl px-4 py-2 transition-all active:scale-95"
            >
              {t('common.done', 'Done')}
            </button>
          </div>
        ) : (
          <>
            <h2 className="text-[var(--text-primary)] font-bold text-base font-[Syne] mb-1">
              {t('friends.reportTitle', 'Report {{name}}', { name: targetName })}
            </h2>
            <p className="text-[var(--text-muted)] text-xs mb-4">
              {t('friends.reportSubtitle', 'Reports are confidential.')}
            </p>

            <label className="block text-[var(--text-secondary)] text-xs mb-1">
              {t('friends.reportReason', 'Reason')}
            </label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as ReportCategory)}
              className="w-full bg-[var(--bg-raised)] border border-[var(--border)] text-[var(--text-primary)] rounded-xl px-3 py-3 text-sm mb-3 focus:border-[var(--accent)] focus:outline-none"
            >
              {REPORT_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {t(`friends.reportCategory.${c}`)}
                </option>
              ))}
            </select>

            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={2000}
              rows={3}
              placeholder={t('friends.reportDetails', 'What happened?') ?? ''}
              className="w-full bg-[var(--bg-raised)] border border-[var(--border)] text-[var(--text-primary)] rounded-xl px-3 py-3 text-sm mb-4 placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none resize-none"
            />

            <div className="flex flex-row gap-2">
              <button
                onClick={onClose}
                className="flex-1 text-sm text-[var(--text-secondary)] border border-[var(--border)] rounded-xl px-4 py-2.5 transition-all active:scale-95"
              >
                {t('common.cancel', 'Cancel')}
              </button>
              <button
                onClick={() => reportMutation.mutate()}
                disabled={reportMutation.isPending || description.trim().length === 0}
                className="flex-1 text-sm text-white gradient-accent rounded-xl px-4 py-2.5 transition-all active:scale-95 disabled:opacity-50"
              >
                {t('friends.reportSubmit', 'Submit report')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
