import { describe, it, expect } from 'vitest'

import {
  parseTableEnvVars,
  envVarToTableKey,
  parseDeclaredTables,
  parseLambdaTableEnv,
  parseDynamodbIam,
  computeClosure,
} from './check-table-closure.mjs'

// Unit tests for the Table_Closure check core (Deployment Parity R4.4).
// Exercises the pure parsers against fixture strings (a fake dynamodb.ts and a
// fake prod main.tf) and the closure computation against a known-gap fixture
// (a Lambda that SETS a table env var its IAM does not grant -> reported) and a
// closed fixture (no gaps). This is the R4 regression: the July-2026
// MusicSchedules AccessDenied was exactly a set-env-without-IAM gap.
//
// **Validates: Requirements 4.4**

// A fake dynamodb.ts: two TableNames accessors plus an out-of-scope var
// (CONNECTIONS_TABLE is a websocket table, not a TableNames accessor) and a
// commented-out one that must not be counted.
const DYNAMODB_TS_FIXTURE = `
export const TableNames = {
  get users() {
    return requireEnv('USERS_TABLE', 'area-code-dev-users')
  },
  get musicSchedules() {
    return requireEnv('MUSIC_SCHEDULES_TABLE', 'area-code-dev-music-schedules')
  },
}
// const stale = requireEnv('LEGACY_TABLE', 'x')
const connections = requireEnv('CONNECTIONS_TABLE', 'area-code-dev-websocket-connections')
`

// A fake prod main.tf with a KNOWN GAP: module.lambda_api SETS both
// USERS_TABLE and MUSIC_SCHEDULES_TABLE, but its IAM grants only the users
// table (base + index). MUSIC_SCHEDULES_TABLE is the uncovered env var.
const TF_FIXTURE_WITH_GAP = `
resource "aws_dynamodb_table" "users" {
  name = "area-code-prod-users"
}

resource "aws_dynamodb_table" "music_schedules" {
  name = "area-code-prod-music-schedules"
}

module "lambda_api" {
  source = "../../modules/lambda"
  environment_variables = {
    AREA_CODE_ENV         = "prod"
    USERS_TABLE           = aws_dynamodb_table.users.name
    MUSIC_SCHEDULES_TABLE = aws_dynamodb_table.music_schedules.name
  }
}

resource "aws_iam_role_policy" "api_dynamodb" {
  name = "dynamodb-access"
  role = module.lambda_api.role_name
  policy = jsonencode({
    Statement = [{
      Effect = "Allow"
      Action = ["dynamodb:GetItem"]
      Resource = [
        aws_dynamodb_table.users.arn,
        "\${aws_dynamodb_table.users.arn}/index/*",
      ]
    }]
  })
}
`

// The closed variant: the same tf but the IAM now also grants music_schedules
// (base + index), so there is no gap.
const TF_FIXTURE_CLOSED = TF_FIXTURE_WITH_GAP.replace(
  '        aws_dynamodb_table.users.arn,\n        "${aws_dynamodb_table.users.arn}/index/*",',
  '        aws_dynamodb_table.users.arn,\n        "${aws_dynamodb_table.users.arn}/index/*",\n' +
    '        aws_dynamodb_table.music_schedules.arn,\n' +
    '        "${aws_dynamodb_table.music_schedules.arn}/index/*",',
)

describe('parseTableEnvVars', () => {
  it('extracts each requireEnv(*_TABLE) accessor name, sorted and unique', () => {
    expect(parseTableEnvVars(DYNAMODB_TS_FIXTURE)).toEqual([
      'CONNECTIONS_TABLE',
      'MUSIC_SCHEDULES_TABLE',
      'USERS_TABLE',
    ])
  })

  it('ignores a table env var mentioned only in a comment', () => {
    expect(parseTableEnvVars(DYNAMODB_TS_FIXTURE)).not.toContain('LEGACY_TABLE')
  })
})

describe('envVarToTableKey', () => {
  it('maps a *_TABLE env var to its lowercase Terraform resource name', () => {
    expect(envVarToTableKey('USERS_TABLE')).toBe('users')
    expect(envVarToTableKey('MUSIC_SCHEDULES_TABLE')).toBe('music_schedules')
    expect(envVarToTableKey('APP_DATA_TABLE')).toBe('app_data')
  })
})

describe('parseDeclaredTables', () => {
  it('finds every aws_dynamodb_table resource name', () => {
    expect(parseDeclaredTables(TF_FIXTURE_WITH_GAP)).toEqual(['music_schedules', 'users'])
  })
})

describe('parseLambdaTableEnv', () => {
  it('captures the *_TABLE vars a lambda module sets, keyed by lambda name', () => {
    const env = parseLambdaTableEnv(TF_FIXTURE_WITH_GAP)
    expect(env).toEqual({
      api: ['MUSIC_SCHEDULES_TABLE', 'USERS_TABLE'],
    })
  })
})

describe('parseDynamodbIam', () => {
  it('splits IAM grants into base-table and /index/* coverage per lambda', () => {
    const iam = parseDynamodbIam(TF_FIXTURE_WITH_GAP)
    expect(iam).toEqual({
      api: { base: ['users'], index: ['users'] },
    })
  })

  it('picks up the added grant in the closed fixture', () => {
    const iam = parseDynamodbIam(TF_FIXTURE_CLOSED)
    expect(iam.api.base).toEqual(['music_schedules', 'users'])
    expect(iam.api.index).toEqual(['music_schedules', 'users'])
  })
})

describe('computeClosure', () => {
  it('reports the gap when a lambda sets a table env var its IAM does not grant', () => {
    const tableEnvVars = parseTableEnvVars(DYNAMODB_TS_FIXTURE)
    const result = computeClosure({
      tableEnvVars,
      envByLambda: parseLambdaTableEnv(TF_FIXTURE_WITH_GAP),
      iamByLambda: parseDynamodbIam(TF_FIXTURE_WITH_GAP),
      declaredTables: parseDeclaredTables(TF_FIXTURE_WITH_GAP),
    })

    expect(result.missingIam).toEqual([{ lambda: 'api', table: 'music_schedules', envVar: 'MUSIC_SCHEDULES_TABLE' }])
    expect(result.missingIndex).toEqual([])
    expect(result.unknownTable).toEqual([])
    // The row is marked not-ok because of the gap.
    expect(result.rows.find((r) => r.lambda === 'api')?.ok).toBe(false)
  })

  it('reports no gaps once the IAM covers every table env var the lambda sets', () => {
    const tableEnvVars = parseTableEnvVars(DYNAMODB_TS_FIXTURE)
    const result = computeClosure({
      tableEnvVars,
      envByLambda: parseLambdaTableEnv(TF_FIXTURE_CLOSED),
      iamByLambda: parseDynamodbIam(TF_FIXTURE_CLOSED),
      declaredTables: parseDeclaredTables(TF_FIXTURE_CLOSED),
    })

    expect(result.missingIam).toEqual([])
    expect(result.missingIndex).toEqual([])
    expect(result.unknownTable).toEqual([])
    expect(result.rows.find((r) => r.lambda === 'api')?.ok).toBe(true)
  })

  it('flags an env var whose table resource does not exist as unknownTable', () => {
    const result = computeClosure({
      tableEnvVars: ['GHOST_TABLE'],
      envByLambda: { api: ['GHOST_TABLE'] },
      iamByLambda: {},
      declaredTables: ['users'],
    })
    expect(result.unknownTable).toEqual([{ lambda: 'api', table: 'ghost', envVar: 'GHOST_TABLE' }])
  })

  it('accepts a broad-IAM / narrow-env asymmetry only when allowlisted', () => {
    const input = {
      tableEnvVars: ['USERS_TABLE', 'NODES_TABLE'],
      // worker sets only USERS_TABLE but its shared-policy IAM grants both.
      envByLambda: { worker: ['USERS_TABLE'] },
      iamByLambda: {
        worker: { base: ['nodes', 'users'], index: ['nodes', 'users'] },
      },
      declaredTables: ['nodes', 'users'],
    }

    const withoutAllowlist = computeClosure(input)
    expect(withoutAllowlist.unexpectedAsymmetries).toEqual([{ lambda: 'worker', extraTables: ['nodes'] }])
    expect(withoutAllowlist.acceptedAsymmetries).toEqual([])

    const withAllowlist = computeClosure({
      ...input,
      broadIamAllowlist: new Map([['worker', 'Shared policy grants all tables.']]),
    })
    expect(withAllowlist.unexpectedAsymmetries).toEqual([])
    expect(withAllowlist.acceptedAsymmetries).toEqual([
      { lambda: 'worker', extraTables: ['nodes'], reason: 'Shared policy grants all tables.' },
    ])
    // Neither direction is ever counted as a hard gap.
    expect(withAllowlist.missingIam).toEqual([])
  })
})
