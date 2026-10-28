'use strict';

const js = require('@eslint/js');
const globals = require('globals');
const formio = require('eslint-config-formio');

// eslint-config-formio predates flat config: its rules are reused as they are, without the rules of
// the React, JSX and import plugins this project does not use.
const formioRules = Object.fromEntries(
  Object.entries(formio.rules).filter(([rule]) => !rule.includes('/'))
);

module.exports = [
  {
    ignores: ['coverage/**', 'node_modules/**', '.yarn/**']
  },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        ...globals.node
      }
    },
    linterOptions: {
      // Older code carries directives for rules that are no longer reported; they are not errors.
      reportUnusedDisableDirectives: 'off'
    },
    rules: {
      ...formioRules,
      'curly': [2, 'all'],
      'no-unused-vars': [1, {'args': 'none', 'caughtErrors': 'none'}],
      'strict': [2, 'global'],
      'max-statements': [2, 35],
      'no-console': 0,
      'indent': ['error', 2],
      'new-cap': ['error', {'capIsNewExceptions': ['Formio']}]
    }
  }
];
