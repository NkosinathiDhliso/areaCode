import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import importPlugin from 'eslint-plugin-import'

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: {
      'react-hooks': reactHooks,
      import: importPlugin,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,

      // Dependency direction enforcement
      'import/no-restricted-paths': [
        'error',
        {
          zones: [
            // packages/shared/ never imports from packages/features/*
            {
              target: './packages/shared/**',
              from: './packages/features/**',
              message: 'packages/shared must never import from packages/features.',
            },
            // packages/* never imports from apps/*
            {
              target: './packages/**',
              from: './apps/**',
              message: 'packages must never import from apps.',
            },
          ],
        },
      ],

      // Import ordering
      'import/order': [
        'warn',
        {
          groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
          'newlines-between': 'always',
          alphabetize: { order: 'asc', caseInsensitive: true },
        },
      ],

      // Prefer explicit types but don't block CI on legacy code
      '@typescript-eslint/no-explicit-any': 'warn',

      // Unused vars: allow underscore-prefixed params (common in callbacks)
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],

      // Max nesting depth
      'max-depth': ['warn', 3],
      'max-nested-callbacks': ['warn', 4],

      // No multiple default exports (one component per file)
      'import/no-default-export': 'warn',

      // Hook cleanup — warn on missing cleanup
      'react-hooks/exhaustive-deps': 'warn',

      // ─── Hard locks for the no-SMS / no-phone-auth decision ───────────────
      // See .kiro/steering/no-sms-no-phone-auth.md.
      // These rules are deliberately strict — `error`, not `warn` — so any
      // attempt to re-introduce phone or SMS code into a UI surface fails CI.
      'no-restricted-syntax': [
        'error',
        {
          // Block <input type="tel"> in any portal — phone is not an identity
          // primitive. If you genuinely need a tel input for some non-auth
          // reason, add an eslint-disable-next-line with a written justification.
          selector: "JSXOpeningElement[name.name='input'] > JSXAttribute[name.name='type'][value.value='tel']",
          message:
            'Phone-number inputs are banned. Auth is email + Google OAuth only. See .kiro/steering/no-sms-no-phone-auth.md.',
        },
      ],
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@aws-sdk/client-pinpoint-sms-voice-v2',
              message:
                'SMS sending is permanently disabled. See .kiro/steering/no-sms-no-phone-auth.md. The existing import in backend/src/shared/sms/feedback.ts is the only allowed reference and is dead code.',
            },
            {
              name: '@aws-sdk/client-pinpoint',
              message:
                'Pinpoint integrations are not used by this platform. See .kiro/steering/no-sms-no-phone-auth.md.',
            },
            {
              name: 'twilio',
              message: 'Third-party SMS providers are banned. See .kiro/steering/no-sms-no-phone-auth.md.',
            },
            {
              name: '@vonage/server-sdk',
              message: 'Third-party SMS providers are banned. See .kiro/steering/no-sms-no-phone-auth.md.',
            },
            {
              name: 'africastalking',
              message: 'Third-party SMS providers are banned. See .kiro/steering/no-sms-no-phone-auth.md.',
            },
            {
              name: 'libphonenumber-js',
              message:
                'Phone-number parsing is banned in app code. Phone is not an identity primitive. See .kiro/steering/no-sms-no-phone-auth.md.',
            },
            {
              name: 'react-phone-input-2',
              message: 'Phone-number inputs are banned. See .kiro/steering/no-sms-no-phone-auth.md.',
            },
            {
              name: 'react-phone-number-input',
              message: 'Phone-number inputs are banned. See .kiro/steering/no-sms-no-phone-auth.md.',
            },
          ],
        },
      ],
    },
  },
  // The dead-code SMS/phone-OTP modules are exempted from the import ban
  // because they intentionally reference @aws-sdk/client-pinpoint-sms-voice-v2.
  // The runtime is gated; see .kiro/steering/no-sms-no-phone-auth.md.
  {
    files: [
      'backend/src/shared/sms/**/*.ts',
      'backend/src/features/auth/handler.ts',
      'backend/src/features/auth/service.ts',
      'backend/src/shared/cognito/client.ts',
      'backend/src/__tests__/e2e.test.ts',
      'backend/src/__tests__/data-integrity.test.ts',
    ],
    rules: {
      'no-restricted-imports': 'off',
    },
  },
  // Service worker environment (uses `self` global)
  {
    files: ['**/public/sw.js', '**/public/service-worker.js'],
    languageOptions: {
      globals: {
        self: 'readonly',
        caches: 'readonly',
        clients: 'readonly',
        registration: 'readonly',
        skipWaiting: 'readonly',
        fetch: 'readonly',
      },
    },
  },
  // Test files: relax unused-vars for mock setup
  {
    files: ['**/__tests__/**', '**/*.test.ts', '**/*.test.tsx', '**/*.spec.ts', '**/*.spec.tsx'],
    rules: {
      '@typescript-eslint/no-unused-vars': 'warn',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  // Playwright e2e suite: fixture signatures collide with React-hook lint rules
  // (the `use` callback is a Playwright API, not a React hook), and empty
  // destructure patterns `({}, use) => {}` are required by Playwright's typing.
  {
    files: ['tests/e2e/**/*.ts'],
    rules: {
      'react-hooks/rules-of-hooks': 'off',
      'no-empty-pattern': 'off',
      'import/no-default-export': 'off',
      'import/order': 'warn',
    },
  },
  // Node-run helper scripts (build/codegen/ops) use Node globals.
  {
    files: ['scripts/**/*.js', 'scripts/**/*.mjs', 'scripts/**/*.cjs'],
    languageOptions: {
      globals: {
        process: 'readonly',
        Buffer: 'readonly',
        console: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        URL: 'readonly',
        fetch: 'readonly',
        module: 'readonly',
        require: 'readonly',
      },
    },
  },
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.turbo/**',
      '**/coverage/**',
      'infra/**',
      '**/*.config.js',
      '**/*.config.ts',
      '**/*.config.mjs',
      '**/build.mts',
      '**/.expo/**',
    ],
  },
)
