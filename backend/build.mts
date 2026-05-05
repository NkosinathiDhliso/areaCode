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
  ],
  banner: {
    js: [
      // ESM compatibility shims for __dirname / require
      // Use long aliases to avoid collisions with minified identifiers
      'import { createRequire as __cjs_require } from "module";',
      'import { fileURLToPath as __cjs_fileurl } from "url";',
      'import { dirname as __cjs_dirname } from "path";',
      'const require = __cjs_require(import.meta.url);',
      'const __filename = __cjs_fileurl(import.meta.url);',
      'const __dirname = __cjs_dirname(__filename);',
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
