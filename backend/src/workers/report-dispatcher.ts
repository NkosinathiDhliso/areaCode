// Lambda entry point for the venue intelligence report dispatcher.
// Triggered by EventBridge on weekly (Monday 04:00 UTC) and monthly
// (1st of the month 04:00 UTC) schedules. The real logic lives in
// features/reports/dispatcher.ts — this file is just the worker bundle entry.
export { handler } from '../features/reports/dispatcher.js'
