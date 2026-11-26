/**
 * Account-store, pool, adapter-failover, and settings-RPC checks.
 *
 *   node test/accounts.mjs
 */
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = await mkdtemp(join(tmpdir(), 'qwen-accounts-'));
process.env.DSH_QWEN_AUTH_FILE = join(dir, 'auth.json');

const { QwenAuth } = await import('../lib/auth.js');
const { AccountPool } = await import('../lib/pool.js');
const { QwenAdapter } = await import('../lib/adapter.js');
const { AuthController } = await import('../lib/rpc.js');
const { accountLabel, readState, writeState } = await import('../lib/store.js');

let checks = 0;
function ok(condition, label) {
  checks += 1;
  assert.ok(condition, label);
  process.stdout.write('  ok  ' + label + '\n');
}
function equal(actual, expected, label) {
  checks += 1;
  assert.deepEqual(actual, expected, label);
  process.stdout.write('  ok  ' + label + '\n');
}
async function collect(iterable) {
  const chunks = [];
  for await (const chunk of iterable) chunks.push(chunk);
  return chunks;
}

const liveTokens = (token) => ({ access_token: token, refresh_token: 'refresh-' + token, token_type: 'Bearer', scope: 'model:invoke', expires_in: 900, expires_at: Date.now() + 900000 });

process.stdout.write('store migration\n');
ok(await readState() === undefined, 'a fresh machine has no store');
await writeFile(process.env.DSH_QWEN_AUTH_FILE, JSON.stringify({
  clientId: 'qwen-code-cli',
  signedInAt: '2026-11-26T11:35:13.509Z',
  tokens: { access_token: 'legacy-1', refresh_token: 'legacy-r', token_type: 'Bearer', expires_in: 900, expires_at: Date.now() + 900000 },
  account: { sub: 'abcdef123456', email: 'legacy@example.com', name: 'Legacy User', member_type: 'pro' },
}), 'utf8');
const migrated = await readState();
equal(migrated.version, 2, 'a version-1 file is migrated on read');
equal(migrated.accounts.length, 1, 'the legacy token becomes one account');
equal(accountLabel(migrated.accounts[0]), 'legacy@example.com', 'the legacy account keeps its email');
equal(migrated.accounts[0].memberType, 'pro', 'the legacy account keeps its member type');
equal(migrated.preferredId, migrated.accounts[0].id, 'the migrated account is preferred');

process.stdout.write('accounts\n');
const auth = new QwenAuth({ logger: { debug() {}, info() {}, warn() {} } });
const second = await auth.signIn({ tokens: liveTokens('token-two'), account: { sub: 'zzz111222333', email: 'second@example.com', name: 'Second', member_type: 'plus' } });
const two = await auth.state();
equal(two.accounts.length, 2, 'a second sign-in adds an account');
equal(two.preferredId, two.accounts[0].id, 'the first account stays preferred');
const again = await auth.signIn({ tokens: liveTokens('token-two-fresh'), account: { sub: 'zzz111222333', email: 'second@example.com' } });
equal((await auth.state()).accounts.length, 2, 'signing the same account in again replaces it');
equal(again.id, second.id, 'the replaced account keeps its id');
equal((await auth.account()).id, two.accounts[0].id, 'the preferred account answers first');
equal((await auth.account(second.id)).id, second.id, 'an explicit id selects that account');
await auth.setPreferred(second.id);
equal((await auth.state()).preferredId, second.id, 'prefer moves the preferred account');
await auth.signIn({ tokens: liveTokens('token-legacy-2'), account: { sub: 'abcdef123456', email: 'legacy@example.com' } });
equal((await auth.state()).accounts.length, 2, 're-signing in does not duplicate the account');
const labeled = await auth.signIn({ tokens: liveTokens('token-two-labeled'), account: { sub: 'zzz111222333', email: 'second@example.com' }, label: 'work subscription' });
equal(accountLabel(labeled), 'work subscription', 'an explicit note becomes the account label');

process.stdout.write('pool order\n');
const pool = new AccountPool({ auth, logger: { warn() {} } });
const ordered = await auth.state();
const candidates = await pool.candidates();
const expectedOrder = [ordered.preferredId, ordered.accounts.find((account) => account.id !== ordered.preferredId).id];
equal(candidates.map((account) => account.id), expectedOrder, 'candidates put the preferred account first');
pool.markFailure(candidates[0].id, { code: 'QUOTA', resetAt: new Date(Date.now() + 3600000).toISOString() });
ok(typeof pool.cooldownOf(candidates[0].id).until === 'string', 'a quota refusal steps the account aside until its reset');
pool.markSuccess(candidates[0].id);
equal(pool.cooldownOf(candidates[0].id), undefined, 'a success clears the cooldown');
pool.markFailure(candidates[1].id, { code: 'RATE_LIMIT', failure: { providerRetryAfterMs: 5000 } });
ok(Math.abs(Date.parse(pool.cooldownOf(candidates[1].id).until) - Date.now() - 5000) < 1000, 'a provider retry delay bounds the cooldown');
pool.markSuccess(candidates[1].id);

process.stdout.write('adapter failover\n');
const sse = [
  'data: ' + JSON.stringify({ id: 'c1', choices: [{ index: 0, delta: { content: 'fallback-ok' } }] }),
  'data: ' + JSON.stringify({ id: 'c1', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 7, completion_tokens: 2, total_tokens: 9 } }),
  'data: [DONE]',
].join('\n\n') + '\n\n';
const seen = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const target = String(url);
  seen.push({ url: target, authorization: init?.headers?.authorization });
  if (!target.endsWith('/chat/completions')) return new Response('{}', { status: 404, headers: { 'content-type': 'application/json' } });
  if (init.headers.authorization === 'Bearer token-legacy-2') {
    return new Response(JSON.stringify({
      type: 'subscription_quota',
      message: 'You have used up your credits.',
      reset_at: new Date(Date.now() + 86400000).toISOString(),
    }), { status: 402, headers: { 'content-type': 'application/json', 'x-request-id': 'req-quota' } });
  }
  return new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } });
};
const legacyAccount = (await auth.state()).accounts.find((account) => accountLabel(account) === 'legacy@example.com');
await auth.setPreferred(legacyAccount.id);
const adapter = new QwenAdapter({ auth, pool, logger: { warn() {} } });
const chunks = await collect(adapter.stream({
  provider: 'qwen',
  model: 'qwen3.8-flash',
  messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
  reasoningEffort: 'off',
}));
globalThis.fetch = realFetch;
equal(seen.length, 2, 'the refused account is tried, then the next one');
equal(chunks.filter((chunk) => chunk.type === 'text-delta').map((chunk) => chunk.text).join(''), 'fallback-ok', 'the answer comes from the surviving account');
equal(chunks[chunks.length - 1].reason, { kind: 'stop' }, 'the failed-over stream still ends cleanly');
const afterFailover = await auth.state();
const refused = afterFailover.accounts.find((account) => accountLabel(account) === 'legacy@example.com');
ok(refused.quota !== undefined && refused.quota.exhausted === true, 'the quota refusal is recorded on the account');
ok(typeof pool.cooldownOf(refused.id).until === 'string', 'the refused account is in cooldown');

process.stdout.write('settings rpc\n');
const fakeAdapter = { apiBase: 'https://api.qwen.ai/compatible-mode/v1', listModels: async () => [{ provider: 'qwen', id: 'qwen4-max', name: 'Qwen4 Max' }] };
const controller = new AuthController({ auth, pool, adapter: fakeAdapter, provider: 'qwen', logger: { info() {}, warn() {}, debug() {} } });
const status = await controller.dispatch('status', {});
equal(status.ok, true, 'status answers successfully');
equal(status.value.accounts.length, 2, 'status lists every account');
equal(status.value.models.map((model) => model.id), ['qwen4-max'], 'status lists the advertised models');
equal(status.value.accounts.filter((account) => account.preferred).length, 1, 'exactly one account is preferred');
ok(status.value.accounts.some((account) => account.quota !== null), 'status exposes the recorded quota refusal');
const unknown = await controller.dispatch('loginPoll', { flowId: 'flow_missing' });
equal([unknown.ok, unknown.error.code], [false, 'AUTH'], 'an unknown sign-in flow is a business failure');
const badEndpoint = await controller.dispatch('nope', {});
equal([badEndpoint.ok, badEndpoint.error.code], [false, 'BAD_REQUEST'], 'an unknown endpoint is refused without throwing');
const preferred = await controller.dispatch('prefer', { accountId: afterFailover.accounts[0].id });
equal(preferred.ok, true, 'prefer answers successfully');
const canceled = await controller.dispatch('loginCancel', { flowId: 'flow_missing' });
equal(canceled.value, { canceled: false }, 'canceling an unknown flow is a no-op');
const signedOut = await controller.dispatch('signOut', { accountId: afterFailover.accounts[0].id });
equal(signedOut.value.signedOut, 1, 'signOut removes one account');
equal((await auth.state()).accounts.length, 1, 'the store keeps the remaining account');

await rm(dir, { recursive: true, force: true });
process.stdout.write('\n' + String(checks) + ' account checks passed\n');
