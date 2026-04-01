import { buildApp } from './app.js'
import { initSocketServer } from './shared/socket/server.js'

const PORT = Number(process.env['PORT'] ?? 4000)

async function start() {
  const app = await buildApp()

  // Attach Socket.io to the same HTTP server
  await app.ready()
  initSocketServer(app.server)
  app.log.info('Socket.io attached to Fastify server')

  app.listen({ port: PORT, host: '0.0.0.0' }, (err: Error | null, address: string) => {
    if (err) {
      app.log.error(err)
      process.exit(1)
    }
    app.log.info(`Server listening on ${address}`)
  })
}

void start()
