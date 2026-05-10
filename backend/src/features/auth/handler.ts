// Auth routes — delegates to domain-specific route modules
import type { FastifyInstance } from 'fastify'
import { registerConsumerRoutes } from './consumer-routes.js'
import { registerBusinessRoutes } from './business-routes.js'
import { registerStaffAdminRoutes } from './staff-admin-routes.js'

export async function authRoutes(app: FastifyInstance) {
  await registerConsumerRoutes(app)
  await registerBusinessRoutes(app)
  await registerStaffAdminRoutes(app)
}
