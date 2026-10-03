import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/node_modules/**', '**/dist/**', '**/out/**', '**/release/**', '**/coverage/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // All OS differences go through apps/desktop/src/main/platform (V1 doc §6). Tests may
    // branch on the OS to pick per-OS fixtures.
    ignores: ['apps/desktop/src/main/platform/**', '**/*.test.ts'],
    rules: {
      'no-restricted-properties': [
        'error',
        ...['process', 'os'].map((object) => ({
          object,
          property: 'platform',
          message: 'Use the platform layer (src/main/platform) instead of branching on the OS.',
        })),
      ],
      'no-restricted-imports': [
        'error',
        {
          paths: ['os', 'node:os'].map((name) => ({
            name,
            importNames: ['platform'],
            message: 'Use the platform layer (src/main/platform) instead of branching on the OS.',
          })),
        },
      ],
    },
  },
  {
    files: ['apps/desktop/src/renderer/**/*.{ts,tsx}'],
    ...reactHooks.configs.flat['recommended-latest'],
    languageOptions: {
      globals: { ...globals.browser },
    },
  },
  prettier,
);
