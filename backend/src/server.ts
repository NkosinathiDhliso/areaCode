import { buildApp } from './app.js'

const PORT = Number(process.env['PORT'] ?? 4000)

async function start() {
  const app = await buildApp()

  await app.ready()

  app.listen({ port: PORT, host: '0.0.0.0' }, (err: Error | null, address: string) => {
    if (err) {
      app.log.error(err)
      process.exit(1)
    }
    app.log.info(`Server listening on ${address}`)
  })
}

void start()
