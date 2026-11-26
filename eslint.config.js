import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['node_modules/**', 'coverage/**'] },
  js.configs.recommended,
  {
    files: ['**/*.{js,cjs}'],
    languageOptions: { ecmaVersion: 'latest' },
    rules: {
      curly: ['error', 'all'],
      eqeqeq: ['error', 'always'],
      'no-console': 'error',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
    },
  },
  {
    files: ['src/**/*.js', 'tests/browser/**/*.js'],
    languageOptions: {
      globals: { ...globals.browser, chrome: 'readonly', Highlight: 'readonly' },
    },
  },
  {
    files: ['tests/**/*.cjs', 'eslint.config.js'],
    languageOptions: { globals: globals.node },
  },
];
