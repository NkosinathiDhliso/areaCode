import type { FastifyRequest, FastifyReply } from 'fastify'
import { z } from 'zod'
import { AppError } from '../errors/AppError.js'

interface ValidationSchemas {
  body?: z.ZodType
  params?: z.ZodType
  query?: z.ZodType
}

interface FieldError {
  field: string
  message: string
}

/**
 * Formats Zod issues into field-level error details.
 * Does not expose internal schema structure (type names, unions, etc.).
 */
function formatFieldErrors(issues: z.ZodIssue[]): FieldError[] {
  return issues.map((issue) => ({
    field: issue.path.length > 0 ? issue.path.join('.') : '_root',
    message: issue.message,
  }))
}

/**
 * Creates a validation AppError with field-level details attached.
 */
function validationError(source: string, issues: z.ZodIssue[]): AppError {
  const fields = formatFieldErrors(issues)
  const summary = fields.map((f) => `${f.field}: ${f.message}`).join('; ')
  const err = new AppError(400, 'validation_error', `Invalid ${source}: ${summary}`)
  ;(err as AppError & { fields: FieldError[] }).fields = fields
  return err
}

/**
 * Zod schema validation middleware.
 * Validates body, params, and/or query against provided schemas.
 * Replaces request properties with parsed (coerced) values.
 * Returns 400 with field-level error details on failure.
 */
export function validate(schemas: ValidationSchemas) {
  return async (request: FastifyRequest, _reply: FastifyReply) => {
    if (schemas.body) {
      const result = schemas.body.safeParse(request.body)
      if (!result.success) {
        throw validationError('request body', result.error.issues)
      }
      ;(request as FastifyRequest & { body: unknown }).body = result.data
    }

    if (schemas.params) {
      const result = schemas.params.safeParse(request.params)
      if (!result.success) {
        throw validationError('path parameters', result.error.issues)
      }
      ;(request as FastifyRequest & { params: unknown }).params = result.data
    }

    if (schemas.query) {
      const result = schemas.query.safeParse(request.query)
      if (!result.success) {
        throw validationError('query parameters', result.error.issues)
      }
      ;(request as FastifyRequest & { query: unknown }).query = result.data
    }
  }
}
