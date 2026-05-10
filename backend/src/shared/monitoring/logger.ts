/**
 * Structured JSON logger for CloudWatch Logs.
 * Outputs one JSON line per log entry to stdout, which CloudWatch Logs picks up automatically.
 *
 * Supports child loggers for per-service/per-request context propagation.
 */

export interface StructuredLogger {
  info(message: string, metadata?: Record<string, unknown>): void
  warn(message: string, metadata?: Record<string, unknown>): void
  error(message: string, metadata?: Record<string, unknown>): void
  child(context: { service: string; requestId?: string; correlationId?: string }): StructuredLogger
}

export interface LogEntry {
  timestamp: string
  level: 'info' | 'warn' | 'error'
  requestId: string
  correlationId: string
  service: string
  message: string
  metadata?: Record<string, unknown>
}

interface LoggerContext {
  service: string
  requestId: string
  correlationId: string
}

function createLogEntry(
  level: LogEntry['level'],
  message: string,
  context: LoggerContext,
  metadata?: Record<string, unknown>,
): LogEntry {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    requestId: context.requestId,
    correlationId: context.correlationId,
    service: context.service,
    message,
  }
  if (metadata && Object.keys(metadata).length > 0) {
    entry.metadata = metadata
  }
  return entry
}

function writeLog(entry: LogEntry): void {
  process.stdout.write(JSON.stringify(entry) + '\n')
}

function createLogger(context: LoggerContext): StructuredLogger {
  return {
    info(message: string, metadata?: Record<string, unknown>): void {
      writeLog(createLogEntry('info', message, context, metadata))
    },
    warn(message: string, metadata?: Record<string, unknown>): void {
      writeLog(createLogEntry('warn', message, context, metadata))
    },
    error(message: string, metadata?: Record<string, unknown>): void {
      writeLog(createLogEntry('error', message, context, metadata))
    },
    child(childContext: { service: string; requestId?: string; correlationId?: string }): StructuredLogger {
      return createLogger({
        service: childContext.service,
        requestId: childContext.requestId ?? context.requestId,
        correlationId: childContext.correlationId ?? context.correlationId,
      })
    },
  }
}

/**
 * Create a root logger instance. Typically called once at app startup.
 * Use `.child()` to create per-request or per-service loggers.
 */
export function createRootLogger(service = 'area-code-api'): StructuredLogger {
  return createLogger({
    service,
    requestId: 'system',
    correlationId: 'system',
  })
}

/**
 * Create a request-scoped logger from API Gateway context.
 */
export function createRequestLogger(opts: {
  service: string
  requestId: string
  correlationId?: string
}): StructuredLogger {
  return createLogger({
    service: opts.service,
    requestId: opts.requestId,
    correlationId: opts.correlationId ?? opts.requestId,
  })
}

/** Singleton root logger for use in non-request contexts (workers, startup) */
export const logger = createRootLogger()
