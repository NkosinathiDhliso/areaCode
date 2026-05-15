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
            // packages/features/* can only import from packages/shared/* — never from another feature
            {
              target: './packages/features/auth/**',
              from: './packages/features/!(auth)/**',
              message: 'Feature packages can only import from packages/shared — never from another feature.',
            },
            {
              target: './packages/features/business/**',
              from: './packages/features/!(business)/**',
              message: 'Feature packages can only import from packages/shared — never from another feature.',
            },
            {
              target: './packages/features/discovery/**',
              from: './packages/features/!(discovery)/**',
              message: 'Feature packages can only import from packages/shared — never from another feature.',
            },
            {
              target: './packages/features/map/**',
              from: './packages/features/!(map)/**',
              message: 'Feature packages can only import from packages/shared — never from another feature.',
            },
            {
              target: './packages/features/profile/**',
              from: './packages/features/!(profile)/**',
              message: 'Feature packages can only import from packages/shared — never from another feature.',
            },
            {
              target: './packages/features/rewards/**',
              from: './packages/features/!(rewards)/**',
              message: 'Feature packages can only import from packages/shared — never from another feature.',
            },
            {
              target: './packages/features/social/**',
              from: './packages/features/!(social)/**',
              message: 'Feature packages can only import from packages/shared — never from another feature.',
            },
            {
              target: './packages/features/staff/**',
              from: './packages/features/!(staff)/**',
              message: 'Feature packages can only import from packages/shared — never from another feature.',
            },
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
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],

      // Max nesting depth
      'max-depth': ['warn', 3],
      'max-nested-callbacks': ['warn', 4],

      // No multiple default exports (one component per file)
      'import/no-default-export': 'warn',

      // Hook cleanup — warn on missing cleanup
      'react-hooks/exhaustive-deps': 'warn',
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
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.turbo/**',
      '**/coverage/**',
      'infra/**',
      '_archive/**',
      '**/*.config.js',
      '**/*.config.ts',
      '**/*.config.mjs',
      '**/build.mts',
      '**/.expo/**',
    ],
  },
)
