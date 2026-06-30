// Lambda entry point for the win-back campaign sender.
// SQS-triggered from the campaign-send queue, one message per batch (<=100
// recipients). The real logic lives in features/campaigns/sender.ts — this
// file is just the worker bundle entry.
export { handler } from '../features/campaigns/sender.js'
