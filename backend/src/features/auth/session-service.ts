import * as sessionRepo from './session-repository.js'

// ─── Session Management ─────────────────────────────────────────────────────

export async function createLoginSession(userId: string, userAgent: string) {
  const deviceInfo = parseDeviceInfo(userAgent)
  return sessionRepo.createSession(userId, deviceInfo)
}

export async function getUserSessions(userId: string, currentSessionId?: string) {
  const sessions = await sessionRepo.listSessions(userId)
  return sessions.map((s) => ({
    ...s,
    isCurrent: s.sessionId === currentSessionId,
  }))
}

export async function revokeSession(userId: string, sessionId: string) {
  await sessionRepo.deleteSession(userId, sessionId)
}

export async function revokeAllOtherSessions(userId: string, currentSessionId: string) {
  const count = await sessionRepo.deleteAllSessionsExcept(userId, currentSessionId)
  return { revoked: count }
}

export async function deleteLoginSession(userId: string, sessionId: string) {
  await sessionRepo.deleteSession(userId, sessionId)
}

function parseDeviceInfo(userAgent: string): string {
  if (!userAgent) return 'Unknown device'
  const ua = userAgent.toLowerCase()
  let browser = 'Unknown browser'
  if (ua.includes('chrome') && !ua.includes('edg')) browser = 'Chrome'
  else if (ua.includes('safari') && !ua.includes('chrome')) browser = 'Safari'
  else if (ua.includes('firefox')) browser = 'Firefox'
  else if (ua.includes('edg')) browser = 'Edge'

  let os = 'Unknown OS'
  if (ua.includes('iphone') || ua.includes('ipad')) os = 'iOS'
  else if (ua.includes('android')) os = 'Android'
  else if (ua.includes('mac os')) os = 'macOS'
  else if (ua.includes('windows')) os = 'Windows'
  else if (ua.includes('linux')) os = 'Linux'

  return `${browser} on ${os}`
}
