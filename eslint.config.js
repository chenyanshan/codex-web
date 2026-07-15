import globals from 'globals';

const correctnessRules = {
  'no-dupe-args': 'error',
  'no-dupe-else-if': 'error',
  'no-dupe-keys': 'error',
  'no-duplicate-case': 'error',
  'no-func-assign': 'error',
  'no-import-assign': 'error',
  'no-redeclare': 'error',
  'no-self-assign': 'error',
  'no-undef': 'error',
  'no-unreachable': 'error',
  'no-unreachable-loop': 'error',
  'no-unsafe-finally': 'error',
  'no-unsafe-negation': 'error',
  'no-unsafe-optional-chaining': 'error',
  'no-useless-backreference': 'error',
  'use-isnan': 'error',
  'valid-typeof': 'error',
};

export default [
  {
    ignores: [
      '.worktrees/**',
      'node_modules/**',
      'packages/*/dist/**',
      'playwright-report/**',
      'test-results/**',
    ],
  },
  {
    files: ['packages/codex-web/public/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.serviceworker,
      },
    },
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
    },
    rules: correctnessRules,
  },
  {
    files: [
      'eslint.config.js',
      'playwright.config.js',
      'packages/codex-web/test/browser/**/*.mjs',
    ],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: globals.node,
    },
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
    },
    rules: correctnessRules,
  },
  {
    files: ['packages/codex-web/test/browser/**/*.spec.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
    },
    rules: correctnessRules,
  },
];
