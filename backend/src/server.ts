import { createServer } from 'node:http'
import { buildApp } from './app.js'
import { initSocketServer } from './shared/socket/server.js'

const API_PORT = Number(process.env['PORT'] ?? 4000)
const SOCKET_PORT = Number(process.env['SOCKET_PORT'] ?? 3001)

// Start the API server
const app = buildApp()

app.listen({ port: API_PORT, host: '0.0.0.0' }, (err, address) => {
  if (err) {
    app.log.error(err)
    process.exit(1)
  }
  app.log.info(`API server listening on ${address}`)

  // Start the Socket.io server on a separate port after API is up
  const httpServer = createServer()
  initSocketServer(httpServer)
  httpServer.listen(SOCKET_PORT, () => {
    app.log.info(`Socket.io server listening on port ${SOCKET_PORT}`)
  })
  httpServer.on('error', (e: NodeJS.ErrnoException) => {
    if (e.code === 'EADDRINUSE') {
      app.log.warn(`Socket port ${SOCKET_PORT} in use, skipping socket server`)
    } else {
      app.log.error(e)
    }
  })
})
