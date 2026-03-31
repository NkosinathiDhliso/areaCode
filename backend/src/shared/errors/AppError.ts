/**
 * Typed application error with HTTP status code.
 * All service-layer errors should throw AppError instances.
 * The global Fastify error handler catches these and returns
 * typed JSON responses.
 */
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly error: string;

  constructor(statusCode: number, error: string, message: string) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.error = error;
  }

  toJSON() {
    return {
      error: this.error,
      message: this.message,
      statusCode: this.statusCode,
    };
  }

  // Common factory methods
  static badRequest(message: string) {
    return new AppError(400, 'bad_request', message);
  }

  static unauthorized(message = 'Unauthorized') {
    return new AppError(401, 'unauthorized', message);
  }

  static forbidden(message = 'Forbidden') {
    return new AppError(403, 'forbidden', message);
  }

  static notFound(message = 'Not found') {
    return new AppError(404, 'not_found', message);
  }

  static conflict(message: string) {
    return new AppError(409, 'conflict', message);
  }

  static gone(message: string) {
    return new AppError(410, 'gone', message);
  }

  static unprocessable(message: string) {
    return new AppError(422, 'unprocessable_entity', message);
  }

  static tooManyRequests(message: string, cooldownUntil?: string) {
    const err = new AppError(429, 'too_many_requests', message);
    if (cooldownUntil) {
      (err as AppError & { cooldownUntil: string }).cooldownUntil = cooldownUntil;
    }
    return err;
  }

  static internal(message = 'Internal server error') {
    return new AppError(500, 'internal_error', message);
  }
}
