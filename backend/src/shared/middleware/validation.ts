import type { FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { AppError } from '../errors/AppError.js';

interface ValidationSchemas {
  body?: z.ZodType;
  params?: z.ZodType;
  query?: z.ZodType;
}

/**
 * Zod schema validation middleware.
 * Validates body, params, and/or query against provided schemas.
 * Replaces request properties with parsed (coerced) values.
 */
export function validate(schemas: ValidationSchemas) {
  return async (request: FastifyRequest, _reply: FastifyReply) => {
    if (schemas.body) {
      const result = schemas.body.safeParse(request.body);
      if (!result.success) {
        const message = result.error.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; ');
        throw AppError.badRequest(message);
      }
      (request as FastifyRequest & { body: unknown }).body = result.data;
    }

    if (schemas.params) {
      const result = schemas.params.safeParse(request.params);
      if (!result.success) {
        const message = result.error.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; ');
        throw AppError.badRequest(message);
      }
      (request as FastifyRequest & { params: unknown }).params = result.data;
    }

    if (schemas.query) {
      const result = schemas.query.safeParse(request.query);
      if (!result.success) {
        const message = result.error.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; ');
        throw AppError.badRequest(message);
      }
      (request as FastifyRequest & { query: unknown }).query = result.data;
    }
  };
}
