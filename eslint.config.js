import js from '@eslint/js';

import prettier from 'eslint-config-prettier';
import prettier_plugin from 'eslint-plugin-prettier';
import globals from 'globals';

/** @type {import('eslint').Linter.Config[]} */
export default [
	js.configs.recommended,
	prettier,
	{
		files: ['**/*.{js,ts}'],
		plugins: {
			prettier: prettier_plugin,
		},
		languageOptions: {
			ecmaVersion: 2022,
			sourceType: 'module',
			globals: {
				...globals.browser,
				...globals.node
			}
		},
		rules: {
			'prettier/prettier': ['error'],
			'no-unused-vars': [
				'warn',
				{
					argsIgnorePattern: '^_',
					varsIgnorePattern: '^$$(Props|Events|Slots|Generic)$'
				}
			],
		}
	},
];
