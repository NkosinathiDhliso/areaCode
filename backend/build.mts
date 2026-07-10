import { build } from 'esbuild'
import { execSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { resolve } from 'node:path'

// Single source of truth for the deployed commit: the sha is baked into the
// bundle here so `GET /health`'s `commit` reflects the code that is actually
// running, not whenever terraform last ran. CI may pre-set AREA_CODE_BUILD_SHA;
// otherwise we read HEAD. If git is genuinely absent (source tarball with no
// .git) we stamp 'unknown' and warn loudly rather than mask the gap.
function resolveBuildSha(): string {
  const fromEnv = process.env.AREA_CODE_BUILD_SHA?.trim()
  if (fromEnv) return fromEnv
  try {
    return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim()
  } catch {
    console.warn('⚠ build:lambda could not resolve git sha; stamping "unknown"')
    return 'unknown'
  }
}

const buildSha = resolveBuildSha()

const sharedBuildOptions = {
  bundle: true,
  platform: 'node' as const,
  target: 'node20',
  format: 'esm' as const,
  minify: true,
  sourcemap: true,
  treeShaking: true,
  define: {
    // Textually replaced into the bundle; app.ts reads it via dot access.
    'process.env.AREA_CODE_BUILD_SHA': JSON.stringify(buildSha),
  },
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
    }),
  ),
)

console.log(
  `✓ Built monolith Lambda + WebSocket Lambda + ${workers.length} worker Lambdas (commit ${buildSha})`,
)
