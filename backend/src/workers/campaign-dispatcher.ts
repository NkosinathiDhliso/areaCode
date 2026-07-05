// Lambda entry point for the win-back campaign dispatcher.
// Async-invoked by the campaign service on send-now. The real logic lives in
// features/campaigns/dispatcher.ts — this file is just the worker bundle entry.
export { handler } from '../features/campaigns/dispatcher.js'
