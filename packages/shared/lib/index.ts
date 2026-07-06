export { api, type ApiError } from './api'
export { getSocket, disconnectSocket, setSocketOverride } from './websocket'
export { getWebSocket, disconnectWebSocket } from './websocket'
export { storage } from './storage'
export {
  isWeb,
  setPageTitle,
  getDeviceInfo,
  isOnline,
  isSaveDataEnabled,
  hasGeolocation,
  getCurrentPosition,
} from './platform'
export { haversineDistance, isWithinRadius } from './geoUtils'
export { formatZAR, formatRelativeTime, formatLocalTime, formatLocalDate, formatCountdown, toE164 } from './formatters'
export * from './featureGating'
export { computeDimensionScores, resolveArchetype, matchesArchetype } from './archetypeResolver'
export {
  LineupEntrySchema,
  ScheduleSlotSchema,
  MusicScheduleSchema,
  ScheduleValidationError,
  validateMusicSchedule,
  type ScheduleValidationCode,
  type ValidationResult,
} from './schedule-validator'
export {
  genresToArchetype,
  GenreToArchetypeValidationError,
  type GenresToArchetypeResult,
  type GenresToArchetypeWarning,
} from './genreToArchetype'
export {
  resolveActiveSlot,
  resolveScheduleClock,
  ScheduleResolverInternalError,
  type ResolvedSlot,
} from './scheduleResolver'
export {
  resolveLiveArchetype,
  LiveArchetypeInternalError,
  type LiveArchetypeInputs,
  type LiveArchetypeResult,
  type LiveArchetypeCheckIn,
} from './liveArchetype'
export {
  createRapidTapDetector,
  TROPHY_TAP_COUNT,
  TROPHY_TAP_GAP_MS,
  type RapidTapOptions,
  type RapidTapDetector,
} from './rapidTap'
