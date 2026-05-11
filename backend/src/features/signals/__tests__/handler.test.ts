import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock DynamoDB before importing handler
const mockSend = vi.fn()
vi.mock('@aws-sdk/lib-dynamodb', () => {
  class MockGetCommand {
    constructor(public params: unknown) {}
  }
  class MockPutCommand {
    constructor(public params: unknown) {}
  }
  class MockQueryCommand {
    constructor(public params: unknown) {}
  }
  class MockUpdateCommand {
    constructor(public params: unknown) {}
  }
  class MockDeleteCommand {
    constructor(public params: unknown) {}
  }
  return {
    DynamoDBDocumentClient: { from: () => ({ send: mockSend }) },
    GetCommand: MockGetCommand,
    PutCommand: MockPutCommand,
    QueryCommand: MockQueryCommand,
    UpdateCommand: MockUpdateCommand,
    DeleteCommand: MockDeleteCommand,
  }
})

// Mock the signal service
const submitSignalMock = vi.fn().mockResolvedValue({
  signalId: 'test-signal-id',
  reputationEarned: 1,
  isProximityReport: false,
})

const getActiveSignalsMock = vi.fn().mockResolvedValue({
  genre: { consensusValue: null, confidenceScore: 0, reportCount: 0, lastUpdatedAt: '' },
  queue: { consensusValue: null, confidenceScore: 0, reportCount: 0, lastUpdatedAt: '' },
})

const disputeSignalMock = vi.fn().mockResolvedValue(undefined)

vi.mock('../service.js', () => ({
  submitSignal: (...args: unknown[]) => submitSignalMock(...args),
  getActiveSignals: (...args: unknown[]) => getActiveSignalsMock(...args),
  disputeSignal: (...args: unknown[]) => disputeSignalMock(...args),
}))

// Mock shared DB module
vi.mock('../../../shared/db/dynamodb.js', () => ({
  documentClient: { send: (...args: unknown[]) => mockSend(...args) },
  TableNames: { appData: 'app-data', nodes: 'nodes', users: 'users', rewards: 'rewards' },
}))

// Mock auth middleware
vi.mock('../../../shared/middleware/auth.js', () => ({
  requireAuth: (..._roles: string[]) => {
    return async (request: any) => {
      const testAuth = request.headers['x-test-auth']
      if (testAuth) {
        request.auth = JSON.parse(testAuth)
      }
    }
  },
  getAuth: (request: any) => {
    if (!request.auth) throw new Error('Not authenticated')
    return request.auth
  },
}))

// Mock validation middleware (pass-through, body already parsed by Fastify)
vi.mock('../../../shared/middleware/validation.js', () => ({
  validate: () => async () => {},
}))

import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'
import { signalRoutes } from '../handler.js'

describe('POST /v1/signals — Owner Report Detection', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    vi.clearAllMocks()

    // Default: node lookup returns a node with businessId 'biz-123'
    mockSend.mockResolvedValue({
      Item: { nodeId: 'node-1', businessId: 'biz-123', lat: -26.2, lng: 28.0 },
    })

    submitSignalMock.mockResolvedValue({
      signalId: 'test-signal-id',
      reputationEarned: 1,
      isProximityReport: false,
    })

    app = Fastify()
    await app.register(signalRoutes)
    await app.ready()
  })

  it('sets isOwner=true when business user owns the node', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/signals',
      headers: {
        'content-type': 'application/json',
        'x-test-auth': JSON.stringify({
          userId: 'biz-123',
          role: 'business',
          cognitoSub: 'sub-biz-123',
        }),
      },
      payload: {
        nodeId: 'node-1',
        type: 'genre_playing',
        value: 'amapiano',
      },
    })

    expect(response.statusCode).toBe(201)
    expect(submitSignalMock).toHaveBeenCalledWith(
      expect.objectContaining({
        isOwner: true,
        userId: 'biz-123',
        nodeId: 'node-1',
        type: 'genre_playing',
        value: 'amapiano',
      }),
    )
  })

  it('sets isOwner=false when business user does NOT own the node', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/signals',
      headers: {
        'content-type': 'application/json',
        'x-test-auth': JSON.stringify({
          userId: 'biz-999',
          role: 'business',
          cognitoSub: 'sub-biz-999',
        }),
      },
      payload: {
        nodeId: 'node-1',
        type: 'genre_playing',
        value: 'amapiano',
      },
    })

    expect(response.statusCode).toBe(201)
    expect(submitSignalMock).toHaveBeenCalledWith(
      expect.objectContaining({
        isOwner: false,
        userId: 'biz-999',
      }),
    )
  })

  it('sets isOwner=false for consumer-authenticated users', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/signals',
      headers: {
        'content-type': 'application/json',
        'x-test-auth': JSON.stringify({
          userId: 'user-456',
          role: 'consumer',
          cognitoSub: 'sub-user-456',
        }),
      },
      payload: {
        nodeId: 'node-1',
        type: 'genre_playing',
        value: 'deep_house',
      },
    })

    expect(response.statusCode).toBe(201)
    expect(submitSignalMock).toHaveBeenCalledWith(
      expect.objectContaining({
        isOwner: false,
        userId: 'user-456',
      }),
    )
  })

  it('sets isOwner=false when node has no businessId', async () => {
    mockSend.mockResolvedValue({
      Item: { nodeId: 'node-1', lat: -26.2, lng: 28.0 },
    })

    const response = await app.inject({
      method: 'POST',
      url: '/v1/signals',
      headers: {
        'content-type': 'application/json',
        'x-test-auth': JSON.stringify({
          userId: 'biz-123',
          role: 'business',
          cognitoSub: 'sub-biz-123',
        }),
      },
      payload: {
        nodeId: 'node-1',
        type: 'genre_playing',
        value: 'amapiano',
      },
    })

    expect(response.statusCode).toBe(201)
    expect(submitSignalMock).toHaveBeenCalledWith(
      expect.objectContaining({
        isOwner: false,
      }),
    )
  })

  it('sets isOwner=false when node does not exist (DynamoDB returns no Item)', async () => {
    mockSend.mockResolvedValue({ Item: undefined })

    const response = await app.inject({
      method: 'POST',
      url: '/v1/signals',
      headers: {
        'content-type': 'application/json',
        'x-test-auth': JSON.stringify({
          userId: 'biz-123',
          role: 'business',
          cognitoSub: 'sub-biz-123',
        }),
      },
      payload: {
        nodeId: 'node-1',
        type: 'genre_playing',
        value: 'amapiano',
      },
    })

    expect(response.statusCode).toBe(201)
    expect(submitSignalMock).toHaveBeenCalledWith(
      expect.objectContaining({
        isOwner: false,
      }),
    )
  })

  it('passes lat/lng coordinates through to the service', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/signals',
      headers: {
        'content-type': 'application/json',
        'x-test-auth': JSON.stringify({
          userId: 'user-456',
          role: 'consumer',
          cognitoSub: 'sub-user-456',
        }),
      },
      payload: {
        nodeId: 'node-1',
        type: 'queue_length',
        value: 'short',
        lat: -26.2041,
        lng: 28.0473,
      },
    })

    expect(response.statusCode).toBe(201)
    expect(submitSignalMock).toHaveBeenCalledWith(
      expect.objectContaining({
        lat: -26.2041,
        lng: 28.0473,
        type: 'queue_length',
        value: 'short',
      }),
    )
  })

  it('does NOT perform DynamoDB node lookup for consumer auth (no ownership check needed)', async () => {
    await app.inject({
      method: 'POST',
      url: '/v1/signals',
      headers: {
        'content-type': 'application/json',
        'x-test-auth': JSON.stringify({
          userId: 'user-456',
          role: 'consumer',
          cognitoSub: 'sub-user-456',
        }),
      },
      payload: {
        nodeId: 'node-1',
        type: 'genre_playing',
        value: 'amapiano',
      },
    })

    // Consumer auth should NOT trigger a DynamoDB lookup for ownership
    expect(mockSend).not.toHaveBeenCalled()
  })
})
