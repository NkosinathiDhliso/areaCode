// Admin Repository — barrel re-export from domain-specific modules
export {
  getUserById,
  getUserCheckInHistory,
  updateUserTier,
  resetAbuseFlags,
  searchConsumers,
} from './consumer-repository.js'

export {
  getBusinessById,
  extendBusinessTrial,
  searchBusinesses,
} from './business-repository.js'

export {
  getReportQueue,
  updateReportStatus,
  getUnreviewedAbuseFlags,
  reviewAbuseFlag,
  listConsents,
  getErasureQueue,
} from './moderation-repository.js'

export {
  createAuditLog,
  createImpersonationLog,
  sendAdminMessage,
  getUserConsentHistory,
  getUsersNeedingReconsent,
  getAuditLogs,
} from './audit-repository.js'

export {
  getDashboardMetrics,
  getArchetypes,
  createArchetype,
  updateArchetypeRecord,
  getGenreWeights,
  updateGenreWeightsRecord,
} from './archetype-repository.js'
