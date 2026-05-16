/**
 * Single source of truth for allowed Origin values.
 *
 * Used by:
 *   - The Fastify CORS plugin (preflight + Access-Control-Allow-Origin)
 *   - The refresh-route Origin guard (defence in depth against CSRF on
 *     refresh-token submissions, since refresh tokens are stored in
 *     localStorage and our APIs are credentialless)
 */

const AMPLIFY_ORIGINS = [
  'https://master.d3pm78r41ma6w6.amplifyapp.com', // web
  'https://master.dbp54yxhyjvk0.amplifyapp.com', // business
  'https://master.d166bb81tg4k61.amplifyapp.com', // staff
  'https://master.d1ay6jict0ql9w.amplifyapp.com', // admin
]

const PROD_ORIGINS = [
  'https://areacode.co.za',
  'https://www.areacode.co.za',
  'https://business.areacode.co.za',
  'https://staff.areacode.co.za',
  'https://admin.areacode.co.za',
  ...AMPLIFY_ORIGINS,
]

const DEV_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:3002',
  'http://localhost:3003',
  'http://localhost:4000',
  ...AMPLIFY_ORIGINS,
]

export function allowedOrigins(): string[] {
  return process.env['AREA_CODE_ENV'] === 'prod' ? PROD_ORIGINS : DEV_ORIGINS
}

/**
 * True if the request's Origin header is on the allowlist.
 *
 * Returns false on missing Origin in prod (a fetch from a CSRF
 * page would set Origin to the attacker's domain). In dev we accept
 * absent Origin so that curl / vitest injections still work.
 */
export function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return process.env['AREA_CODE_ENV'] !== 'prod'
  return allowedOrigins().includes(origin)
}
