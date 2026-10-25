// Runs every *.test.mjs in this directory against the built module in ../dist.
// Each test file runs in its own process, so one crash cannot hide the others.
import { spawn } from 'node:child_process'
import { readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

if (!existsSync(join(here, '..', 'dist', 'main.js'))) {
	console.error('dist is missing. Run "yarn build" first.')
	process.exit(1)
}

const files = (await readdir(here)).filter((name) => name.endsWith('.test.mjs')).sort()
if (files.length === 0) {
	console.error('No test files found.')
	process.exit(1)
}

let failed = 0
for (const file of files) {
	console.log(`\n=== ${file} ===`)
	const code = await new Promise((resolve) => {
		const child = spawn(process.execPath, [join(here, file)], { stdio: 'inherit' })
		child.on('close', resolve)
	})
	if (code !== 0) failed++
}

console.log(failed === 0 ? `\n${files.length} test file(s) passed` : `\n${failed} test file(s) failed`)
process.exit(failed === 0 ? 0 : 1)
