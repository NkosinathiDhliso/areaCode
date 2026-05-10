// Admin routes — delegates to domain-specific route modules
import type { FastifyInstance } from 'fastify'
import { registerAdminCoreRoutes } from './admin-core-routes.js'
import { registerAdminConfigRoutes } from './admin-config-routes.js'
import { registerRevenueRoutes } from './revenue-routes.js'

export async function adminRoutes(app: FastifyInstance) {
  await registerAdminCoreRoutes(app)
  await registerAdminConfigRoutes(app)
  await registerRevenueRoutes(app)
}
