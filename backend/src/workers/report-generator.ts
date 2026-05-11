// Lambda entry point for the venue intelligence report generator.
// SQS-triggered from the report-generation queue, one message per business.
// The real logic lives in features/reports/generator.ts — this file is just
// the worker bundle entry.
export { handler } from '../features/reports/generator.js'
