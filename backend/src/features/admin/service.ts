// Admin Service — barrel re-export from domain-specific modules
export { checkPermission } from './permissions.js'

export {
  getUser,
  getUserCheckInHistory,
  resetAbuseFlags,
  sendMessage,
  searchConsumers,
  consumerAction,
  disableUser,
} from './consumer-service.js'

export {
  getBusiness,
  extendTrial,
  setBusinessTier,
  getBusinessStaff,
  revokeStaffAccess,
  searchBusinesses,
  businessAction,
  disableBusiness,
} from './business-service.js'

export {
  getReportQueue,
  actionReport,
  startImpersonation,
  getConsentHistory,
  getReconsentList,
  listConsents,
  getErasureQueue,
  getAbuseFlags,
  reviewAbuseFlag,
  actionAbuseFlag,
} from './moderation-service.js'

export {
  getArchetypes,
  createArchetype,
  updateArchetype,
  getGenreWeights,
  testArchetype,
  updateGenreWeights,
  getDashboardMetrics,
  getAuditLogs,
} from './archetype-service.js'
