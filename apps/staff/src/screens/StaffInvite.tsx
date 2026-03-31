import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { api } from '@area-code/shared/lib/api'

interface StaffInviteProps {
  token: string
}

export function StaffInvite({ token }: StaffInviteProps) {
  const { t } = useTranslation()
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')

  async function handleAccept() {
    setStatus('loading')
    try {
      await api.post('/v1/staff-invite/accept', { token })
      setStatus('success')
    } catch {
      setStatus('error')
    }
  }

  return (
    <div className="flex flex-col items-center justify-center h-dvh bg-[var(--bg-base)] px-5">
      <h1 className="text-[var(--text-primary)] font-bold text-2xl mb-6 font-[Syne]">
        {t('staff.invite.title')}
      </h1>

      {status === 'idle' && (
        <button
          onClick={handleAccept}
          className="bg-[var(--accent)] text-white font-semibold rounded-xl py-4 px-8 text-base transition-all duration-150 active:scale-95"
        >
          {t('staff.invite.title')}
        </button>
      )}

      {status === 'loading' && (
        <p className="text-[var(--text-secondary)]">{t('staff.invite.accepting')}</p>
      )}

      {status === 'success' && (
        <div className="flex flex-col items-center gap-4">
          <p className="text-[var(--success)]">{t('staff.invite.success')}</p>
          <a
            href="/staff/login"
            className="text-[var(--accent)] underline text-sm"
          >
            {t('staff.login.title')}
          </a>
        </div>
      )}

      {status === 'error' && (
        <p className="text-[var(--danger)]">{t('staff.invite.expired')}</p>
      )}
    </div>
  )
}
