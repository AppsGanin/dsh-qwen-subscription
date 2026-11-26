/**
 * Transport checks for the settings routes: the `/api/qwen-auth.*` envelope, its
 * refusal branches, and the dispatch results a page receives.
 *
 *   node test/rpc-transport.mjs
 */
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = await mkdtemp(join(tmpdir(), 'qwen-rpc-'));
process.env.DSH_QWEN_AUTH_FILE = join(dir, 'auth.json');

const { QwenAuth } = await import('../lib/auth.js');
const { AccountPool } = await import('../lib/pool.js');
const { AuthController, AUTH_ENDPOINTS, registerAuthRoutes } = await import('../lib/rpc.js');

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

const auth = new QwenAuth({ logger: { debug() {}, info() {}, warn() {} } });
await auth.signIn({
  tokens: { access_token: 'token-a', refresh_token: 'refresh-a', expires_at: Date.now() + 900000 },
  account: { sub: 'aaaa111222333', email: 'rpc@example.com', name: 'RPC User', member_type: 'plus' },
});
const adapter = { apiBase: 'https://api.qwen.ai/compatible-mode/v1', listModels: async () => [{ provider: 'qwen', id: 'qwen4-max', name: 'Qwen4 Max' }] };
const controller = new AuthController({ auth, pool: new AccountPool({ auth }), adapter, provider: 'qwen', logger: { info() {}, warn() {}, debug() {} } });

const routes = [];
const ctx = {
  logger: { debug() {} },
  inject(names, callback) {
    for (const name of names) {
      if (name !== 'connection') continue;
      callback({
        get: () => ({
          fetch: {
            register(route) {
              routes.push(route);
              return async () => {};
            },
          },
        }),
        effect(callback2) {
          return callback2();
        },
      });
    }
  },
};
registerAuthRoutes(ctx, controller);

equal(routes.length, AUTH_ENDPOINTS.length, 'every endpoint gets one exact route');
equal(routes.map((route) => route.path).sort(), AUTH_ENDPOINTS.map((endpoint) => '/api/qwen-auth.' + endpoint).sort(), 'the routes use the shared /api channel and the plugin prefix');
ok(routes.every((route) => route.methods.length === 1 && route.methods[0] === 'POST'), 'every route accepts exactly POST');
ok(routes.every((route) => route.requestBody === 'buffered'), 'every route buffers its JSON body');

function envelope(method, rpcId, payload) {
  return new Request('http://localhost/api/' + method, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId, method, payload }),
  });
}

const statusRoute = routes.find((route) => route.path === '/api/qwen-auth.status');
const statusResponse = await statusRoute.fetch(envelope('qwen-auth.status', 'rpc-1', {}));
equal(statusResponse.status, 200, 'a valid call answers 200');
const statusBody = await statusResponse.json();
equal(statusBody.type, 'server-response', 'the answer is one server-response envelope');
equal(statusBody.rpcId, 'rpc-1', 'the answer echoes the request id');
equal(statusBody.result.ok, true, 'status reports success');
equal(statusBody.result.value.accounts.length, 1, 'status carries the signed-in account');

const mismatch = await statusRoute.fetch(envelope('qwen-auth.prefer', 'rpc-2', {}));
const mismatchBody = await mismatch.json();
equal([mismatchBody.result.ok, mismatchBody.result.error.code], [false, 'BAD_REQUEST'], 'a method that does not match its route is refused');

const wrongType = await statusRoute.fetch(new Request('http://localhost/api/qwen-auth.status', {
  method: 'POST',
  headers: { 'content-type': 'text/plain' },
  body: 'hello',
}));
equal(wrongType.status, 415, 'a non-JSON content type is refused');

const garbage = await statusRoute.fetch(new Request('http://localhost/api/qwen-auth.status', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ rpcId: 'rpc-3' }),
}));
const garbageBody = await garbage.json();
equal([garbageBody.rpcId, garbageBody.result.ok], ['rpc-3', false], 'a malformed envelope is refused but keeps the request id');

const pollRoute = routes.find((route) => route.path === '/api/qwen-auth.loginPoll');
const pollBody = await (await pollRoute.fetch(envelope('qwen-auth.loginPoll', 'rpc-4', { flowId: 'flow_missing' }))).json();
equal([pollBody.result.ok, pollBody.result.error.code], [false, 'AUTH'], 'an unknown sign-in flow comes back as a business failure');

const startRoute = routes.find((route) => route.path === '/api/qwen-auth.loginStart');
const realFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
  if (String(url).endsWith('/api/oauth/device/code')) {
    return new Response(JSON.stringify({ device_code: 'dev-1', user_code: 'ABCD-1234', expires_in: 600, interval: 5 }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }
  return new Response('{}', { status: 404, headers: { 'content-type': 'application/json' } });
};
const started = await (await startRoute.fetch(envelope('qwen-auth.loginStart', 'rpc-5', {}))).json();
equal(started.result.ok, true, 'loginStart answers successfully');
equal(started.result.value.userCode, 'ABCD-1234', 'loginStart returns the provider user code');
ok(typeof started.result.value.flowId === 'string' && started.result.value.flowId.startsWith('flow_'), 'loginStart returns a flow id');
ok(started.result.value.url.includes('user_code=ABCD-1234'), 'loginStart returns the approval URL');
const pending = await (await pollRoute.fetch(envelope('qwen-auth.loginPoll', 'rpc-6', { flowId: started.result.value.flowId }))).json();
equal(pending.result.value, { state: 'pending' }, 'an unapproved flow reports pending');
const canceled = await (await routes.find((route) => route.path === '/api/qwen-auth.loginCancel').fetch(envelope('qwen-auth.loginCancel', 'rpc-7', { flowId: started.result.value.flowId }))).json();
equal(canceled.result.value, { canceled: true }, 'cancel stops the flow');
const afterCancel = await (await pollRoute.fetch(envelope('qwen-auth.loginPoll', 'rpc-8', { flowId: started.result.value.flowId }))).json();
equal(afterCancel.result.ok, false, 'a canceled flow is gone');
globalThis.fetch = realFetch;

// test-connection endpoint (account still present, token live)
{
  const testRoute = routes.find((route) => route.path === '/api/qwen-auth.test');
  const realFetch2 = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/models')) return new Response(JSON.stringify({ data: [{ id: 'qwen4-max' }, { id: 'qwen3.8-flash' }] }), { status: 200, headers: { 'content-type': 'application/json' } });
    return new Response('{}', { status: 404 });
  };
  const tested = await (await testRoute.fetch(envelope('qwen-auth.test', 'rpc-10', {}))).json();
  globalThis.fetch = realFetch2;
  equal(tested.result.ok, true, 'test connection answers successfully');
  equal(tested.result.value.models, 2, 'test connection reports the model count');
  ok(Number.isFinite(tested.result.value.latencyMs), 'test connection reports latency');
  const aborted = new AbortController();
  aborted.abort();
  const abortedResult = await controller.dispatch('test', {}, aborted.signal);
  equal([abortedResult.ok, abortedResult.error.code], [false, 'ABORTED'], 'an aborted connection test reports ABORTED');
}

const signOutRoute = routes.find((route) => route.path === '/api/qwen-auth.signOut');
const signOutBody = await (await signOutRoute.fetch(envelope('qwen-auth.signOut', 'rpc-9', {}))).json();
equal(signOutBody.result.value.signedOut, 1, 'signOut without an id removes the account');

await rm(dir, { recursive: true, force: true });
process.stdout.write('\n' + String(checks) + ' transport checks passed\n');
