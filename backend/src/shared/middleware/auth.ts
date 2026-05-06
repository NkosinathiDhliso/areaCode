import type { FastifyRequest, FastifyReply } from 'fastify'
import jwt from 'jsonwebtoken'
import jwksClient from 'jwks-rsa'
import { AppError } from '../errors/AppError.js'
import { getUserByCognitoSub, getStaffByCognitoSub } from '../../features/auth/dynamodb-repository.js'
import { findBusinessByCognitoSub } from '../../features/business/repository.js'

export type AuthRole = 'consumer' | 'business' | 'staff' | 'admin'

export interface AuthPayload {
  userId: string
  role: AuthRole
  cognitoSub: string
  citySlug?: string | undefined
  /** Present on many federated access tokens (e.g. Google via Hosted UI). */
  email?: string | undefined
}

// Cognito pool config , each pool has its own JWKS endpoint
interface PoolConfig {
  poolId: string
  clientId: string
  region: string
}

function getPoolConfig(role: AuthRole): PoolConfig {
  const region = process.env['AWS_REGION'] ?? 'us-east-1'
  switch (role) {
    case 'consumer':
      return {
        poolId: process.env['AREA_CODE_COGNITO_CONSUMER_USER_POOL_ID'] ?? '',
        clientId: process.env['AREA_CODE_COGNITO_CONSUMER_CLIENT_ID'] ?? '',
        region,
      }
    case 'business':
      return {
        poolId: process.env['AREA_CODE_COGNITO_BUSINESS_USER_POOL_ID'] ?? '',
        clientId: process.env['AREA_CODE_COGNITO_BUSINESS_CLIENT_ID'] ?? '',
        region,
      }
    case 'staff':
      return {
        poolId: process.env['AREA_CODE_COGNITO_STAFF_USER_POOL_ID'] ?? '',
        clientId: process.env['AREA_CODE_COGNITO_STAFF_CLIENT_ID'] ?? '',
        region,
      }
    case 'admin':
      return {
        poolId: process.env['AREA_CODE_COGNITO_ADMIN_USER_POOL_ID'] ?? '',
        clientId: process.env['AREA_CODE_COGNITO_ADMIN_CLIENT_ID'] ?? '',
        region,
      }
  }
}

// Cache JWKS clients per pool
const jwksClients = new Map<string, jwksClient.JwksClient>()

function getJwksClient(poolConfig: PoolConfig): jwksClient.JwksClient {
  const key = `${poolConfig.region}:${poolConfig.poolId}`
  let client = jwksClients.get(key)
  if (!client) {
    client = jwksClient({
      jwksUri: `https://cognito-idp.${poolConfig.region}.amazonaws.com/${poolConfig.poolId}/.well-known/jwks.json`,
      cache: true,
      cacheMaxAge: 600_000, // 10 min
    })
    jwksClients.set(key, client)
  }
  return client
}

async function verifyToken(token: string, role: AuthRole): Promise<AuthPayload> {
  const poolConfig = getPoolConfig(role)
  const client = getJwksClient(poolConfig)

  // Decode header to get kid
  const decoded = jwt.decode(token, { complete: true })
  if (!decoded || typeof decoded === 'string') {
    throw AppError.unauthorized('Invalid token')
  }

  const kid = decoded.header.kid
  if (!kid) {
    throw AppError.unauthorized('Invalid token header')
  }

  const signingKey = await client.getSigningKey(kid)
  const publicKey = signingKey.getPublicKey()

  const payload = jwt.verify(token, publicKey, {
    issuer: `https://cognito-idp.${poolConfig.region}.amazonaws.com/${poolConfig.poolId}`,
    algorithms: ['RS256'],
  }) as jwt.JwtPayload

  // Extract user info from Cognito claims
  const cognitoSub = payload['sub']
  if (!cognitoSub || typeof cognitoSub !== 'string') {
    throw AppError.unauthorized('Missing sub claim')
  }

  // userId is stored as a custom claim by our auth service (phone OTP path).
  // Federated users often omit it until sync refreshes tokens; resolve Dynamo ids by sub.
  let userId = (payload['custom:userId'] as string | undefined) ?? cognitoSub
  if (role === 'consumer' && !payload['custom:userId']) {
    const row = await getUserByCognitoSub(cognitoSub)
    if (row?.userId) userId = row.userId
  }

  if (role === 'business') {
    const bid = payload['custom:businessId'] as string | undefined
    if (bid) userId = bid
    else {
      const biz = await findBusinessByCognitoSub(cognitoSub)
      const id = biz?.businessId as string | undefined
      if (id) userId = id
    }
  }

  if (role === 'staff') {
    const sid = payload['custom:staffId'] as string | undefined
    if (sid) userId = sid
    else {
      const st = await getStaffByCognitoSub(cognitoSub)
      if (st?.staffId) userId = st.staffId
    }
  }

  const citySlug = payload['custom:citySlug'] as string | undefined

  const email = typeof payload['email'] === 'string' ? payload.email : undefined

  return { userId, role, cognitoSub, citySlug, email }
}

/**
 * Creates a Fastify preHandler that verifies JWT for the given role(s).
 * Attaches `request.auth` with the verified payload.
 */
export function requireAuth(...roles: AuthRole[]) {
  return async (request: FastifyRequest, _reply: FastifyReply) => {
    // Dev mode: accept any Bearer token and create a mock auth payload

    const authHeader = request.headers.authorization
    if (!authHeader?.startsWith('Bearer ')) {
      throw AppError.unauthorized('Missing or invalid Authorization header')
    }

    const token = authHeader.slice(7)
    let lastError: Error | null = null

    // Try each allowed role's pool
    for (const role of roles) {
      try {
        const payload = await verifyToken(token, role)
        // Attach to request
        ;(request as FastifyRequest & { auth: AuthPayload }).auth = payload
        return
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err))
      }
    }

    throw lastError instanceof AppError ? lastError : AppError.unauthorized('Invalid or expired token')
  }
}

/**
 * Optional auth , attaches auth payload if token present, otherwise continues.
 * If a token is present but invalid/expired, returns 401 so the client knows to re-auth.
 */
export function optionalAuth(...roles: AuthRole[]) {
  return async (request: FastifyRequest, _reply: FastifyReply) => {
    const authHeader = request.headers.authorization
    if (!authHeader?.startsWith('Bearer ')) {
      return
    }

    const token = authHeader.slice(7)
    for (const role of roles) {
      try {
        const payload = await verifyToken(token, role)
        ;(request as FastifyRequest & { auth: AuthPayload }).auth = payload
        return
      } catch {
        // Try next role
      }
    }
    // Token present but invalid , inform client so they can refresh
    throw AppError.unauthorized('Token expired or invalid')
  }
}

// Type helper for routes that use requireAuth
export function getAuth(request: FastifyRequest): AuthPayload {
  const auth = (request as FastifyRequest & { auth?: AuthPayload }).auth
  if (!auth) {
    throw AppError.unauthorized('Not authenticated')
  }
  return auth
}

export function getOptionalAuth(request: FastifyRequest): AuthPayload | null {
  return (request as FastifyRequest & { auth?: AuthPayload }).auth ?? null
}
