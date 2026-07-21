import js from '@eslint/js';

export default [
  { ignores: ['node_modules/**', 'test-results/**', 'playwright-report/**', 'assets/**'] },
  js.configs.recommended,
  {
    files: ['js/**/*.js', 'tests/**/*.{js,mjs}', '*.mjs', '*.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: {
        window: 'readonly', document: 'readonly', localStorage: 'readonly',
        navigator: 'readonly', requestAnimationFrame: 'readonly', cancelAnimationFrame: 'readonly',
        performance: 'readonly', console: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly',
        setInterval: 'readonly', clearInterval: 'readonly', fetch: 'readonly',
        AudioContext: 'readonly', OscillatorNode: 'readonly', CustomEvent: 'readonly',
        CodeMirror: 'readonly', ResizeObserver: 'readonly', URL: 'readonly',
        process: 'readonly', Buffer: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'no-undef': 'error',
    },
  },
  {
    // Vercel Edge Functions — web-standard runtime globals (fetch/Request/Response)
    // plus process.env for secrets.
    files: ['api/**/*.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: {
        fetch: 'readonly', Request: 'readonly', Response: 'readonly',
        process: 'readonly', console: 'readonly', URL: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-undef': 'error',
    },
  },
];
