// Admin configuration routes — archetypes, genre weights, IAM
import type { FastifyInstance } from 'fastify'
import { requireAuth, getAuth } from '../../shared/middleware/auth.js'
import * as service from './service.js'
import * as cognito from '../../shared/cognito/client.js'
import { getAdminRole } from './admin-core-routes.js'
import { getSystemHealth } from './system-health-service.js'

export async function registerAdminConfigRoutes(app: FastifyInstance) {
  const adminAuth = requireAuth('admin')

  // ─── System Health ──────────────────────────────────────────────────────

  app.get('/v1/admin/system-health', { preHandler: [adminAuth] }, async () => {
    return getSystemHealth()
  })

  // ─── Archetype Management ───────────────────────────────────────────────

  app.get('/v1/admin/archetypes', { preHandler: [adminAuth] }, async () => {
    return service.getArchetypes()
  })

  app.post('/v1/admin/archetypes', { preHandler: [adminAuth] }, async (request) => {
    const auth = getAuth(request)
    const role = await getAdminRole(request)
    return service.createArchetype(auth.userId, role, request.body as Record<string, unknown>)
  })

  app.patch('/v1/admin/archetypes/:id', { preHandler: [adminAuth] }, async (request) => {
    const auth = getAuth(request)
    const role = await getAdminRole(request)
    const params = request.params as { id: string }
    return service.updateArchetype(auth.userId, role, params.id, request.body as Record<string, unknown>)
  })

  app.post('/v1/admin/archetypes/test', { preHandler: [adminAuth] }, async (request) => {
    const body = request.body as { genres?: string[] }
    return service.testArchetype(body.genres ?? [])
  })

  // ─── Genre Weight Management ────────────────────────────────────────────

  app.get('/v1/admin/genre-weights', { preHandler: [adminAuth] }, async () => {
    return service.getGenreWeights()
  })

  app.patch('/v1/admin/genre-weights', { preHandler: [adminAuth] }, async (request) => {
    const auth = getAuth(request)
    const role = await getAdminRole(request)
    return service.updateGenreWeights(auth.userId, role, request.body as Record<string, unknown>)
  })

  // ─── Admin IAM (super_admin only) ────────────────────────────────────────

  app.get('/v1/admin/iam/admins', { preHandler: [adminAuth] }, async (request) => {
    const role = await getAdminRole(request)
    if (role !== 'super_admin') throw { statusCode: 403, message: 'Forbidden' }
    const admins = await cognito.listAdminUsers()
    return { admins }
  })

  app.post('/v1/admin/iam/admins', { preHandler: [adminAuth] }, async (request, reply) => {
    const callerRole = await getAdminRole(request)
    if (callerRole !== 'super_admin') throw { statusCode: 403, message: 'Forbidden' }
    const body = request.body as { email: string; tempPassword: string; role: string }
    const validRoles = ['super_admin', 'support_agent', 'content_moderator']
    if (!body.email || !body.tempPassword || !validRoles.includes(body.role)) {
      return reply.status(400).send({ message: 'email, tempPassword and role are required' })
    }
    const result = await cognito.createAdminUser(body.email, body.tempPassword, body.role)
    return reply.status(201).send({ sub: result.sub, email: body.email, role: body.role })
  })

  app.patch('/v1/admin/iam/admins/:adminId/role', { preHandler: [adminAuth] }, async (request, reply) => {
    const callerRole = await getAdminRole(request)
    if (callerRole !== 'super_admin') throw { statusCode: 403, message: 'Forbidden' }
    const { adminId } = request.params as { adminId: string }
    const body = request.body as { role: string }
    const validRoles = ['super_admin', 'support_agent', 'content_moderator']
    if (!validRoles.includes(body.role)) {
      return reply.status(400).send({ message: 'Invalid role' })
    }
    await cognito.setAdminUserRole(adminId, body.role)
    return { success: true }
  })

  app.post('/v1/admin/iam/admins/:adminId/deactivate', { preHandler: [adminAuth] }, async (request) => {
    const callerRole = await getAdminRole(request)
    if (callerRole !== 'super_admin') throw { statusCode: 403, message: 'Forbidden' }
    const auth = getAuth(request)
    const { adminId } = request.params as { adminId: string }
    if (adminId === auth.cognitoSub) throw { statusCode: 400, message: 'Cannot deactivate your own account' }
    await cognito.disableCognitoUser('admin', adminId)
    return { success: true }
  })
}
