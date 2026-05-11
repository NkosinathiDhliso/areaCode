import type { FastifyInstance } from 'fastify'
import { requireAuth, getAuth } from '../../shared/middleware/auth.js'
import { validate } from '../../shared/middleware/validation.js'
import {
  submitSignalBodySchema,
  disputeBodySchema,
  signalIdParamsSchema,
  nodeIdParamsSchema,
} from './types.js'
import { submitSignal, getActiveSignals, disputeSignal } from './service.js'
import type { SubmitSignalBody, DisputeBody } from './types.js'
import { z } from 'zod'
import { GetCommand } from '@aws-sdk/lib-dynamodb'
import { documentClient, TableNames } from '../../shared/db/dynamodb.js'

export async function signalRoutes(app: FastifyInstance) {
  // ─── POST /v1/signals — Submit a signal (consumer or business auth) ─────────
  app.post(
    '/v1/signals',
    {
      preHandler: [requireAuth('consumer', 'business'), validate({ body: submitSignalBodySchema })],
    },
    async (request, reply) => {
      const auth = getAuth(request)
      const body = request.body as SubmitSignalBody

      // Determine if user is the owner of the node (business auth submitting on own venue)
      let isOwner = false
      if (auth.role === 'business') {
        const nodeRecord = await documentClient.send(
          new GetCommand({
            TableName: TableNames.nodes,
            Key: { nodeId: body.nodeId },
            ProjectionExpression: 'businessId',
          }),
        )
        if (nodeRecord.Item && nodeRecord.Item['businessId'] === auth.userId) {
          isOwner = true
        }
      }

      const result = await submitSignal({
        userId: auth.userId,
        nodeId: body.nodeId,
        type: body.type,
        value: body.value,
        lat: body.lat,
        lng: body.lng,
        isOwner,
      })

      return reply.status(201).send({
        signalId: result.signalId,
        reputationEarned: result.reputationEarned,
      })
    },
  )

  // ─── GET /v1/signals/:nodeId — Get active signals with consensus for a node ─
  app.get(
    '/v1/signals/:nodeId',
    {
      preHandler: [validate({ params: nodeIdParamsSchema })],
    },
    async (request) => {
      const params = request.params as z.infer<typeof nodeIdParamsSchema>
      return getActiveSignals(params.nodeId)
    },
  )

  // ─── POST /v1/signals/:signalId/dispute — Dispute a signal (business auth) ──
  app.post(
    '/v1/signals/:signalId/dispute',
    {
      preHandler: [requireAuth('business'), validate({ params: signalIdParamsSchema, body: disputeBodySchema })],
    },
    async (request, reply) => {
      const auth = getAuth(request)
      const params = request.params as z.infer<typeof signalIdParamsSchema>
      const body = request.body as DisputeBody

      await disputeSignal(params.signalId, auth.userId, body.reason, body.nodeId)

      return reply.status(201).send({ success: true })
    },
  )
}
