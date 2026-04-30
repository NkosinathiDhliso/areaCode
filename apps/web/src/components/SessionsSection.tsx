import { useTranslation } from 'react-i18next'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@area-code/shared/lib/api'

interface Session {
  sessionId: string
  deviceInfo: string
  createdAt: string
  lastActiveAt: string
  isCurrent: boolean
}

interface SessionsResponse {
  sessions: Session[]
}

interface SessionsSectionProps {
  currentSessionId: string | null
}

export function SessionsSection({ currentSessionId }: SessionsSectionProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['sessions', currentSessionId],
    queryFn: () => {
      const params = currentSessionId ? `?currentSessionId=${currentSessionId}` : ''
      return api.get<SessionsResponse>(`/v1/users/me/sessions${params}`)
    },
    staleTime: 60_000,
  })

  const revokeMutation = useMutation({
    mutationFn: (sessionId: string) =>
      api.delete(`/v1/users/me/sessions/${sessionId}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['sessions'] })
    },
  })

  const revokeAllMutation = useMutation({
    mutationFn: () =>
      api.post('/v1/users/me/sessions/revoke-all', { currentSessionId }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['sessions'] })
    },
  })

  const sessions = data?.sessions ?? []
  const hasOtherSessions = sessions.some((s) => !s.isCurrent)

  if (isLoading) {
    return (
      <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-4 mb-3">
        <h3 className="text-[var(--text-secondary)] text-xs font-medium uppercase tracking-wider mb-3">
          {t('profile.sessions', 'Sessions')}
        </h3>
        <div className="flex flex-col gap-2">
          {[1, 2].map((i) => (
            <div key={i} className="h-14 bg-[var(--bg-raised)] rounded-xl animate-pulse" />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-4 mb-3">
      <h3 className="text-[var(--text-secondary)] text-xs font-medium uppercase tracking-wider mb-3">
        {t('profile.sessions', 'Sessions')}
      </h3>

      <div className="flex flex-col gap-2">
        {sessions.map((session) => (
          <div
            key={session.sessionId}
            className="flex flex-row items-center justify-between bg-[var(--bg-raised)] rounded-xl px-3 py-2.5"
          >
            <div className="flex flex-col gap-0.5 flex-1 min-w-0">
              <div className="flex flex-row items-center gap-2">
                <span className="text-[var(--text-primary)] text-sm font-medium truncate">
                  {session.deviceInfo}
                </span>
                {session.isCurrent && (
                  <span className="text-[var(--accent)] text-xs font-medium shrink-0">
                    {t('profile.thisDevice', 'This device')}
                  </span>
                )}
              </div>
              <span className="text-[var(--text-muted)] text-xs">
                {t('profile.lastActive', 'Last active')}{' '}
                {formatRelativeTime(session.lastActiveAt)}
              </span>
            </div>

            {!session.isCurrent && (
              <button
                onClick={() => revokeMutation.mutate(session.sessionId)}
                disabled={revokeMutation.isPending}
                className="text-[var(--danger)] text-xs font-medium ml-3 shrink-0 transition-all active:scale-95"
              >
                {t('profile.signOut', 'Sign out')}
              </button>
            )}
          </div>
        ))}
      </div>

      {hasOtherSessions && currentSessionId && (
        <button
          onClick={() => revokeAllMutation.mutate()}
          disabled={revokeAllMutation.isPending}
          className="w-full text-[var(--danger)] text-sm font-medium py-2.5 mt-3 border border-[var(--border-strong)] rounded-xl transition-all active:scale-95"
        >
          {revokeAllMutation.isPending
            ? t('common.loading', 'Loading...')
            : t('profile.signOutAllOther', 'Sign out all other devices')}
        </button>
      )}
    </div>
  )
}

function formatRelativeTime(isoDate: string): string {
  const now = Date.now()
  const then = new Date(isoDate).getTime()
  const diffMs = now - then
  const diffMin = Math.floor(diffMs / 60_000)

  if (diffMin < 1) return 'just now'
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHours = Math.floor(diffMin / 60)
  if (diffHours < 24) return `${diffHours}h ago`
  const diffDays = Math.floor(diffHours / 24)
  if (diffDays < 30) return `${diffDays}d ago`
  return new Date(isoDate).toLocaleDateString()
}
