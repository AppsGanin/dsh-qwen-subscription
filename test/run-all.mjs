/**
 * Run every offline suite and report one aggregate result.
 *
 * The suites are plain scripts (not node:test files), so `node --test` is the
 * wrong runner; this spawns each, keeps its output, and exits non-zero if any
 * fails. Live suites are excluded: they need a signed-in account and network.
 *
 *   npm test   ->   node test/run-all.mjs
 */
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const suites = [
  'smoke',
  'accounts',
  'rpc-transport',
  'adapter-contract',
  'mount',
  'client-mount',
  'regressions',
  'credential-lock',
  'usage-ledger',
]

function run(file) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [file], { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    child.stdout.on('data', (chunk) => { out += chunk })
    child.stderr.on('data', (chunk) => { out += chunk })
    child.on('error', (error) => resolve({ code: 1, out: String(error) }))
    child.on('close', (code) => resolve({ code: code === null ? 1 : code, out }))
  })
}

let failed = 0
for (const name of suites) {
  const result = await run(join(here, name + '.mjs'))
  const lines = result.out.trim().split('\n')
  const last = lines[lines.length - 1] || ''
  if (result.code === 0) {
    process.stdout.write('PASS  ' + name.padEnd(18) + last + '\n')
  } else {
    failed += 1
    process.stdout.write('FAIL  ' + name + '\n' + result.out + '\n')
  }
}

process.stdout.write(failed === 0 ? '\nall offline suites passed\n' : '\n' + String(failed) + ' suite(s) failed\n')
process.exit(failed === 0 ? 0 : 1)
