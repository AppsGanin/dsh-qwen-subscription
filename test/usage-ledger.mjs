/**
 * Usage ledger: cumulative counters, persistence, concurrent records, adapter
 * recording on a successful stream, and exposure through the status endpoint.
 *
 *   node test/usage-ledger.mjs
 */
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = await mkdtemp(join(tmpdir(), 'qwen-usage-'));
process.env.DSH_QWEN_AUTH_FILE = join(dir, 'auth.json');

const { UsageLedger } = await import('../lib/usage.js');
const { QwenAuth } = await import('../lib/auth.js');
const { AccountPool } = await import('../lib/pool.js');
const { QwenAdapter } = await import('../lib/adapter.js');
const { AuthController } = await import('../lib/rpc.js');

let checks = 0;
function ok(condition, label) { checks += 1; assert.ok(condition, label); process.stdout.write('  ok  ' + label + '\n'); }
function equal(actual, expected, label) { checks += 1; assert.deepEqual(actual, expected, label); process.stdout.write('  ok  ' + label + '\n'); }
const J = JSON.stringify;

process.stdout.write('ledger counters\n');
{
  const ledger = new UsageLedger();
  await ledger.record('a1', { inputTokens: 10, outputTokens: 4 });
  await ledger.record('a1', { inputTokens: 7, outputTokens: 2 });
  await ledger.record('a2', { inputTokens: 1, outputTokens: 1 });
  const totals = await ledger.totals();
  equal(totals.a1.requests, 2, 'requests accumulate');
  equal(totals.a1.inputTokens, 17, 'input tokens accumulate');
  equal(totals.a1.outputTokens, 6, 'output tokens accumulate');
  equal(totals.a2.requests, 1, 'accounts are tracked separately');
  const reloaded = new UsageLedger();
  equal((await reloaded.totals()).a1.inputTokens, 17, 'totals persist across instances');
}

process.stdout.write('concurrent records\n');
{
  const ledger = new UsageLedger();
  await Promise.all(Array.from({ length: 6 }, () => ledger.record('c1', { inputTokens: 1, outputTokens: 1 })));
  equal((await ledger.totals()).c1.requests, 6, 'concurrent records do not lose updates');
}

process.stdout.write('adapter records usage on success\n');
{
  const auth = new QwenAuth({ logger: { debug() {} } });
  await auth.signIn({ tokens: { access_token: 'tok', refresh_token: 'r', expires_at: Date.now() + 600000 }, account: { sub: 'usage-sub', email: 'usage@example.com' } });
  const account = await auth.account();
  const pool = new AccountPool({ auth, logger: { warn() {} } });
  const recorded = [];
  const usage = { record: async (id, u) => { recorded.push({ id, u }); } };
  const adapter = new QwenAdapter({ auth, pool, usage, logger: { warn() {} } });
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(
    'data: ' + J({ choices: [{ index: 0, delta: { content: 'hi' } }] }) + '\n\n' +
    'data: ' + J({ choices: [], usage: { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25 } }) + '\n\n' +
    'data: [DONE]\n\n',
    { status: 200, headers: { 'content-type': 'text/event-stream' } });
  const chunks = [];
  for await (const chunk of adapter.stream({ provider: 'qwen', model: 'qwen3.8-flash', messages: [] })) chunks.push(chunk);
  globalThis.fetch = realFetch;
  equal(recorded.length, 1, 'usage was recorded once');
  equal(recorded[0].id, account.id, 'usage is attributed to the serving account');
  equal(recorded[0].u.inputTokens, 20, 'recorded input tokens match the stream');
  equal(recorded[0].u.outputTokens, 5, 'recorded output tokens match the stream');
}

process.stdout.write('status exposes usage\n');
{
  const auth = new QwenAuth({ logger: { debug() {} } });
  const account = await auth.account();
  const ledger = new UsageLedger();
  await ledger.record(account.id, { inputTokens: 3, outputTokens: 2 });
  const controller = new AuthController({ auth, pool: new AccountPool({ auth }), usage: ledger, adapter: { listModels: async () => [] }, provider: 'qwen', logger: { info() {}, warn() {}, debug() {} } });
  const status = await controller.dispatch('status', {});
  equal(status.value.accounts[0].usage.requests, 1, 'status carries the account usage');
  equal(status.value.accounts[0].usage.inputTokens, 3, 'status carries input tokens');
}

await rm(dir, { recursive: true, force: true });
process.stdout.write('\n' + String(checks) + ' usage-ledger checks passed\n');
