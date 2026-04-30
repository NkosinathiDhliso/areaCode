import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../lib/api'

interface BlockUserButtonProps {
  targetUserId: string
  isBlocked: boolean
  onToggle?: (blocked: boolean) => void
}

export function BlockUserButton({ targetUserId, isBlocked, onToggle }: BlockUserButtonProps) {
  const { t } = useTranslation()
  const [blocked, setBlocked] = useState(isBlocked)
  const [loading, setLoading] = useState(false)
  const [confirming, setConfirming] = useState(false)

  async function handleBlock() {
    setConfirming(false)
    setLoading(true)
    try {
      await api.post(`/v1/users/me/block/${targetUserId}`, {})
      setBlocked(true)
      onToggle?.(true)
    } catch {
      // Silently fail — user sees no state change
    } finally {
      setLoading(false)
    }
  }

  async function handleUnblock() {
    setLoading(true)
    try {
      await api.delete(`/v1/users/me/block/${targetUserId}`)
      setBlocked(false)
      onToggle?.(false)
    } catch {
      // Silently fail
    } finally {
      setLoading(false)
    }
  }

  if (confirming) {
    return (
      <div className="flex flex-row items-center gap-2">
        <span className="text-[var(--text-muted)] text-xs">
          {t('privacy.block.confirm')}
        </span>
        <button
          onClick={handleBlock}
          disabled={loading}
          className="text-xs text-white bg-[var(--danger)] rounded-xl px-3 py-1.5 transition-all active:scale-95 disabled:opacity-60"
        >
          {t('privacy.block.yes')}
        </button>
        <button
          onClick={() => setConfirming(false)}
          className="text-xs text-[var(--text-secondary)] border border-[var(--border)] rounded-xl px-3 py-1.5 transition-all active:scale-95"
        >
          {t('privacy.block.cancel')}
        </button>
      </div>
    )
  }

  if (blocked) {
    return (
      <button
        onClick={handleUnblock}
        disabled={loading}
        className="text-xs text-[var(--text-secondary)] border border-[var(--border)] rounded-xl px-3 py-1.5 transition-all active:scale-95 disabled:opacity-60"
      >
        {loading ? (
          <span className="inline-flex items-center gap-1.5">
            <span className="w-3 h-3 border-2 border-[var(--text-muted)] border-t-transparent rounded-full animate-spin" />
            {t('privacy.block.unblocking')}
          </span>
        ) : (
          t('privacy.block.unblock')
        )}
      </button>
    )
  }

  return (
    <button
      onClick={() => setConfirming(true)}
      disabled={loading}
      className="text-xs text-[var(--danger)] border border-[var(--danger)]/30 rounded-xl px-3 py-1.5 transition-all active:scale-95 disabled:opacity-60"
    >
      {loading ? (
        <span className="inline-flex items-center gap-1.5">
          <span className="w-3 h-3 border-2 border-[var(--danger)] border-t-transparent rounded-full animate-spin" />
          {t('privacy.block.blocking')}
        </span>
      ) : (
        t('privacy.block.block')
      )}
    </button>
  )
}
