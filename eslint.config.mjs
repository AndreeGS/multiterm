import tseslint from 'typescript-eslint';

/**
 * Lint enxuto: so regras que pegam bug de verdade, nao estilo. A principal e
 * promessa solta — o codigo marca as intencionais com `void`.
 */
export default tseslint.config(
  { ignores: ['dist/', 'node_modules/', 'scripts/', 'bin/', 'eslint.config.mjs'] },
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    plugins: { '@typescript-eslint': tseslint.plugin },
    rules: {
      '@typescript-eslint/no-floating-promises': ['error', {
        // describe/it do node:test devolvem promessa, mas o runner as acompanha.
        allowForKnownSafeCalls: [{ from: 'package', package: 'node:test', name: ['describe', 'it', 'test'] }],
      }],
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: false }],
      '@typescript-eslint/no-unnecessary-type-assertion': 'error',
      'no-debugger': 'error',
      eqeqeq: ['error', 'smart'],
    },
  },
);
