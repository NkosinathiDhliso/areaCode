import { buildApp } from './app.js'
import { initSocketServer } from './shared/socket/server.js'

const PORT = Number(process.env['PORT'] ?? 4000)

const app = buildApp()

// Wait for Fastify to be ready, then attach Socket.io to the same HTTP server
void app.ready().then(() => {
  initSocketServer(app.server)
  app.log.info('Socket.io attached to Fastify server')
})

app.listen({ port: PORT, host: '0.0.0.0' }, (err, address) => {
  if (err) {
    app.log.error(err)
    process.exit(1)
  }
  app.log.info(`Server listening on ${address}`)
})
