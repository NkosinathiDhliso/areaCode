import http from 'k6/http'
import { check, sleep } from 'k6'
import { randomIntBetween } from 'https://jslib.k6.io/k6-utils/1.2.0/index.js'

export const options = {
  stages: [
    { duration: '30s', target: 50 }, // Ramp up to 50 concurrent users
    { duration: '1m', target: 50 }, // Stay at 50 for 1 minute
    { duration: '30s', target: 200 }, // Ramp up to 200 concurrent users (Spike)
    { duration: '1m', target: 200 }, // Stay at 200 for 1 minute
    { duration: '30s', target: 0 }, // Ramp down to 0
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'], // 95% of requests must complete below 500ms
    http_req_failed: ['rate<0.01'], // Error rate must be less than 1%
  },
}

const BASE_URL = __ENV.API_URL || 'http://localhost:4000/v1'
const NODE_ID = '00000000-0000-0000-0000-000000000001'

export default function () {
  // 1. Get health
  const rootUrl = BASE_URL.replace('/v1', '')
  const healthRes = http.get(`${rootUrl}/health`)
  check(healthRes, { 'health is 200': (r) => r.status === 200 })

  sleep(1)

  // 2. Fetch live nodes (Map view)
  const nodesRes = http.get(`${BASE_URL}/nodes/trending`)
  check(nodesRes, { 'trending nodes is 200': (r) => r.status === 200 })

  sleep(randomIntBetween(1, 3))

  // 3. Attempt unauthenticated check-in (should return 401, verifies middleware perf)
  const checkInRes = http.post(
    `${BASE_URL}/check-in`,
    JSON.stringify({
      nodeId: NODE_ID,
      type: 'presence',
      lat: -26.2041,
      lng: 28.0473,
    }),
    {
      headers: { 'Content-Type': 'application/json' },
    },
  )
  check(checkInRes, { 'unauth check-in is 401': (r) => r.status === 401 })

  sleep(randomIntBetween(2, 5))
}
