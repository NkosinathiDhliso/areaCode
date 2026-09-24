export { api, type ApiError } from './api'
export { classifyLoginError, type LoginErrorKind, type LoginErrorClassification } from './loginError'
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
export { mediaUrl } from './mediaUrl'
export { formatZAR, formatRelativeTime, formatCountdown, toE164 } from './formatters'
export * from './featureGating'
export { computeDimensionScores, resolveArchetype, matchesArchetype } from './archetypeResolver'
export {
  LineupEntrySchema,
  ScheduleSlotSchema,
  MusicScheduleSchema,
  ScheduleValidationError,
  validateMusicSchedule,
  parseCalendarDate,
  dayOfWeekForCalendarDate,
  DATED_SLOT_MAX_DAYS_AHEAD,
  HEADLINE_MAX_LENGTH,
  type ScheduleValidationCode,
  type ScheduleValidationOptions,
  type ValidationResult,
} from './schedule-validator'
export { featuredGetHasEnded, isFeaturableGet, type FeaturableGet } from './featuredGet'
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
export { recordVenueOpen, computeAwayFlag, type AwayFlagInput, type OpenSource } from './venueOpen'
export {
  SAST_OFFSET_MS,
  SAST_TIME_ZONE,
  instantMs,
  sastDateString,
  startOfSastDayIso,
  secondsUntilNextSastMidnight,
  formatSastDate,
  formatSastLongDate,
  formatSastDayMonth,
  formatSastTime,
  formatSastDateTime,
  toSastDateTimeLocal,
  sastDateTimeLocalToIso,
  type Instant,
} from './sast'
export { describeApiError, describeOAuthError, classifyApiError, API_ERROR_COPY, type ApiErrorKind } from './apiError'
export {
  hasClipboard,
  copyToClipboard,
  clipboardFailureCopy,
  CLIPBOARD_UNAVAILABLE_COPY,
  CLIPBOARD_FAILED_COPY,
  type ClipboardOutcome,
} from './clipboard'
export {
  isStorageAvailable,
  readStored,
  writeStored,
  removeStored,
  readStoredJson,
  writeStoredJson,
  SIGN_IN_STORAGE_REQUIRED_COPY,
  type StorageArea,
} from './safeStorage'
export {
  trackEvent,
  flushEvents,
  setAnalyticsOptIn,
  isAnalyticsOptedIn,
  resetUsageBeaconForTest,
  USAGE_EVENT_NAMES,
  isUsageEventName,
  type UsageEventName,
  type UsageEventProps,
} from './usageEvents'
