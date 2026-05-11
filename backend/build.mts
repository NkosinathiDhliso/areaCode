import { build } from 'esbuild'
import { readdirSync } from 'node:fs'
import { resolve } from 'node:path'

const sharedBuildOptions = {
  bundle: true,
  platform: 'node' as const,
  target: 'node20',
  format: 'esm' as const,
  minify: true,
  sourcemap: true,
  treeShaking: true,
  external: [
    // AWS SDK v3 is provided in the Lambda runtime
    '@aws-sdk/*',
    // sharp ships platform-specific native binaries; it is not bundled into
    // the API Lambda. Image post-processing runs in a separate worker Lambda
    // with a sharp-bearing layer.
    'sharp',
  ],
  banner: {
    js: [
      // ESM compatibility shims for __dirname / require.
      // Names are deliberately verbose so esbuild's minifier cannot generate
      // colliding identifiers in bundled third-party code (e.g. sentry/otel
      // had a generated `_dn` that collided with the previous shim).
      'import { createRequire as __esbCreateRequire } from "module";',
      'import { fileURLToPath as __esbFileURLToPath } from "url";',
      'import { dirname as __esbDirname } from "path";',
      'const require = __esbCreateRequire(import.meta.url);',
      'const __filename = __esbFileURLToPath(import.meta.url);',
      'const __dirname = __esbDirname(__filename);',
    ].join(''),
  },
}

// Build the monolith Lambda (API Gateway handler)
await build({
  ...sharedBuildOptions,
  entryPoints: ['src/lambda.ts'],
  outfile: 'dist/lambda/index.mjs',
})

// Build the WebSocket Lambda (API Gateway WebSocket handler)
await build({
  ...sharedBuildOptions,
  entryPoints: ['src/lambdas/websocket.ts'],
  outfile: 'dist/websocket/index.mjs',
})

// Build individual worker Lambdas in parallel
const workerDir = resolve('src/workers')
const workers = readdirSync(workerDir)
  .filter((f) => f.endsWith('.ts') && !f.includes('.test.') && !f.endsWith('-repository.ts'))
  .map((f) => f.replace('.ts', ''))

await Promise.all(
  workers.map((worker) =>
    build({
      ...sharedBuildOptions,
      entryPoints: [`src/workers/${worker}.ts`],
      outfile: `dist/workers/${worker}/index.mjs`,
    })
  )
)

console.log(`✓ Built monolith Lambda + WebSocket Lambda + ${workers.length} worker Lambdas`)
