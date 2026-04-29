// Lambda entry point — wraps the Fastify app for API Gateway v2
import awsLambdaFastify from '@fastify/aws-lambda'
import { buildApp } from './app.js'

let proxy: ReturnType<typeof awsLambdaFastify> | null = null

async function getProxy() {
  if (!proxy) {
    const app = await buildApp()
    await app.ready()
    proxy = awsLambdaFastify(app, {
      decorateRequest: true,
    })
  }
  return proxy
}

export async function handler(event: unknown, context: unknown, callback: unknown) {
  try {
    const p = await getProxy()
    return p(event as never, context as never, callback as never)
  } catch (err) {
    console.error('[lambda] Handler error:', err)
    // Return a proper API Gateway v2 response so CORS headers are added
    return {
      statusCode: 500,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ error: 'internal_error', message: 'Internal server error' }),
    }
  }
}
