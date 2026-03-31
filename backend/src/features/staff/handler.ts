import type { FastifyInstance } from 'fastify'
import { requireAuth, getAuth } from '../../shared/middleware/auth.js'
import { getStaffRecentRedemptions } from '../rewards/service.js'

export async function staffRoutes(app: FastifyInstance) {
  // GET /v1/staff/recent-redemptions
  app.get(
    '/v1/staff/recent-redemptions',
    { preHandler: [requireAuth('staff')] },
    async (request) => {
      const auth = getAuth(request)
      return getStaffRecentRedemptions(auth.userId)
    },
  )
}
