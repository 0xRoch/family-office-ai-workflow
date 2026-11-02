const tseslint = require('@typescript-eslint/eslint-plugin');

module.exports = [
  {
    ignores: ['dist/**', 'node_modules/**']
  },
  ...tseslint.configs['flat/recommended'],
  {
    rules: {
      // Existing sources use `any` at external API boundaries. Retyping them
      // is outside this dependency upgrade.
      '@typescript-eslint/no-explicit-any': 'off',
      // cli.tsx is intentionally unchecked; require a short reason.
      '@typescript-eslint/ban-ts-comment': ['error', {
        'ts-nocheck': 'allow-with-description',
        minimumDescriptionLength: 10
      }]
    }
  }
];
