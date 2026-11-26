/**
 * Cross-process credential lock: serialization, stale-lock reclamation, and
 * reuse of a token another process already refreshed.
 *
 *   node test/credential-lock.mjs
 */
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = await mkdtemp(join(tmpdir(), 'qwen-lock-'));
process.env.DSH_QWEN_AUTH_FILE = join(dir, 'auth.json');

const { withCredentialLock, writeState, readState } = await import('../lib/store.js');
const { QwenAuth } = await import('../lib/auth.js');

let checks = 0;
function ok(condition, label) { checks += 1; assert.ok(condition, label); process.stdout.write('  ok  ' + label + '\n'); }
function equal(actual, expected, label) { checks += 1; assert.deepEqual(actual, expected, label); process.stdout.write('  ok  ' + label + '\n'); }

process.stdout.write('serialization\n');
{
  let active = false;
  let overlapped = false;
  let completed = 0;
  const task = () => withCredentialLock(async () => {
    if (active) overlapped = true;
    active = true;
    await new Promise((resolve) => setTimeout(resolve, 15));
    active = false;
    completed += 1;
  });
  await Promise.all([task(), task(), task(), task(), task()]);
  equal(completed, 5, 'every locked section ran');
  equal(overlapped, false, 'no two locked sections overlapped');
}

process.stdout.write('stale lock reclamation\n');
{
  const lockPath = process.env.DSH_QWEN_AUTH_FILE + '.lock';
  await mkdir(lockPath);
  const old = new Date(Date.now() - 120000);
  await utimes(lockPath, old, old);
  let ran = false;
  await withCredentialLock(async () => { ran = true; }, { staleMs: 60000 });
  equal(ran, true, 'an abandoned lock is reclaimed and the section runs');
}

process.stdout.write('reuse of a token another process refreshed\n');
{
  await writeState({ version: 2, clientId: 'qwen-code-cli', accounts: [
    { id: 'a1', tokens: { access_token: 'live-token', refresh_token: 'r1', expires_at: Date.now() + 600000 } },
  ], preferredId: 'a1' });
  const auth = new QwenAuth({ logger: { debug() {} } });
  const realFetch = globalThis.fetch;
  let networkCalls = 0;
  globalThis.fetch = async () => { networkCalls += 1; throw new Error('network must not be touched'); };
  const stale = { id: 'a1', tokens: { access_token: 'old', refresh_token: 'r1', expires_at: Date.now() - 1000 } };
  const token = await auth.refresh(stale, undefined, false);
  globalThis.fetch = realFetch;
  equal(token, 'live-token', 'the already-refreshed token is reused');
  equal(networkCalls, 0, 'no refresh exchange happened');
}

process.stdout.write('lock is released after a failure\n');
{
  let threw = false;
  try {
    await withCredentialLock(async () => { throw new Error('boom'); });
  } catch (error) {
    threw = error.message === 'boom';
  }
  equal(threw, true, 'the section error propagates');
  let ran = false;
  await withCredentialLock(async () => { ran = true; });
  equal(ran, true, 'the lock was released despite the failure');
}

await rm(dir, { recursive: true, force: true });
process.stdout.write('\n' + String(checks) + ' credential-lock checks passed\n');
