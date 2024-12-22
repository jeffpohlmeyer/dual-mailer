import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import prettier_plugin from 'eslint-plugin-prettier';
import globals from 'globals';
import * as tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';

/** @type {import('eslint').Linter.Config[]} */
export default [
	js.configs.recommended,
	prettier,
	{
		files: ['**/*.js'],
		plugins: {
			prettier: prettier_plugin
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
			]
		}
	},
	{
		files: ['**/*.{ts,d.ts}'],
		plugins: {
			'@typescript-eslint': tseslint,
			prettier: prettier_plugin
		},
		languageOptions: {
			parser: tsparser,
			ecmaVersion: 2022,
			sourceType: 'module',
			globals: {
				...globals.browser,
				...globals.node
			}
		},
		rules: {
			'prettier/prettier': ['error'],
			...tseslint.configs['eslint-recommended'].rules,
			...tseslint.configs['recommended'].rules
		}
	}
];
