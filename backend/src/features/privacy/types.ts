import { z } from 'zod'

// ─── Privacy Settings ─────────────────────────────────────────────────────

export const privacyLevelSchema = z.enum(['public', 'friends_only', 'private'])

export const updatePrivacyBodySchema = z.object({
  privacyLevel: privacyLevelSchema,
}).strict()

// ─── Block ────────────────────────────────────────────────────────────────

export const blockParamsSchema = z.object({
  targetUserId: z.string().min(1),
})

// ─── Report ───────────────────────────────────────────────────────────────

export const reportCategorySchema = z.enum([
  'harassment_report',
  'stalking',
  'spam',
  'inappropriate_content',
  'other',
])

export const createReportBodySchema = z.object({
  reportedUserId: z.string().min(1),
  category: reportCategorySchema,
  description: z.string().min(1).max(2000),
}).strict()
