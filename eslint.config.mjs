import { generateEslintConfig } from '@companion-module/tools/eslint/config.mjs'

const baseConfig = await generateEslintConfig({
	enableTypescript: true,
})

export default [
	...baseConfig,
	{
		// The test and diagnostic scripts are development tools: they run the built output
		// directly and report their result through the exit code, which the module never does.
		files: ['tests/**/*.mjs', 'scripts/**/*.mjs'],
		rules: {
			'n/no-unpublished-import': 'off',
			'n/no-process-exit': 'off',
		},
	},
]
