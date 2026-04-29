import { build } from 'esbuild'
import { readdirSync } from 'node:fs'
import { resolve } from 'node:path'

// Build the monolith Lambda (API Gateway handler)
await build({
  entryPoints: ['src/lambda.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  outfile: 'dist/lambda/index.mjs',
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
      'import { createRequire as _cr } from "module";',
      'import { fileURLToPath as _fp } from "url";',
      'import { dirname as _dn } from "path";',
      'const require = _cr(import.meta.url);',
      'const __filename = _fp(import.meta.url);',
      'const __dirname = _dn(__filename);',
    ].join(''),
  },
})

// Build individual worker Lambdas
const workerDir = resolve('src/workers')
const workers = readdirSync(workerDir)
  .filter((f) => f.endsWith('.ts') && !f.includes('.test.'))
  .map((f) => f.replace('.ts', ''))

for (const worker of workers) {
  await build({
    entryPoints: [`src/workers/${worker}.ts`],
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'esm',
    outfile: `dist/workers/${worker}/index.mjs`,
    minify: true,
    sourcemap: true,
    treeShaking: true,
    external: ['@aws-sdk/*'],
    banner: {
      js: [
        'import { createRequire as _cr } from "module";',
        'import { fileURLToPath as _fp } from "url";',
        'import { dirname as _dn } from "path";',
        'const require = _cr(import.meta.url);',
        'const __filename = _fp(import.meta.url);',
        'const __dirname = _dn(__filename);',
      ].join(''),
    },
  })
}

console.log(`✓ Built monolith Lambda + ${workers.length} worker Lambdas`)
