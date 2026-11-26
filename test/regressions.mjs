/**
 * Regression probes for bugs found in audit: late tool-call ids, in-band stream
 * error classification, and the sign-in poll race. Plus the neighbouring paths
 * those fixes touch.
 *
 *   node test/regressions.mjs
 */
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = await mkdtemp(join(tmpdir(), 'qwen-regressions-'));
process.env.DSH_QWEN_AUTH_FILE = join(dir, 'auth.json');

const { translateStream } = await import('../lib/translate.js');
const { parseSseData } = await import('../lib/sse.js');
const { providerFailure } = await import('../lib/errors.js');
const { QwenAuth } = await import('../lib/auth.js');
const { AccountPool } = await import('../lib/pool.js');
const { QwenAdapter } = await import('../lib/adapter.js');
const { AuthController } = await import('../lib/rpc.js');

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
function sse(events) {
  return (async function* () {
    const encoder = new TextEncoder();
    for (const event of events) yield encoder.encode('data: ' + event + '\n\n');
  })();
}
const J = JSON.stringify;
const liveTokens = (token) => ({ access_token: token, refresh_token: 'refresh-' + token, expires_at: Date.now() + 600000 });

process.stdout.write('late tool-call id\n');
{
  const chunks = await collect(translateStream(parseSseData(sse([
    J({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { name: 'add', arguments: '{"a":' } }] } }] }),
    J({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_real', function: { arguments: '1}' } }] }, finish_reason: 'tool_calls' }] }),
    '[DONE]',
  ])), { model: 'm' }));
  const end = chunks.find((chunk) => chunk.type === 'block-end');
  equal(end.block.id, 'call_real', 'a tool id arriving in a later delta replaces the synthetic one');
  const lastDelta = chunks.filter((chunk) => chunk.type === 'tool-call-delta').pop();
  equal(lastDelta.id, 'call_real', 'later deltas carry the real id');
}

process.stdout.write('in-band stream errors\n');
{
  const cases = [
    [{ error: { message: 'boom', type: 'server_error' } }, 'SERVER'],
    [{ error: { message: 'slow down', type: 'rate_limit_error' } }, 'RATE_LIMIT'],
    [{ error: { message: 'bad key', type: 'authentication_error' } }, 'AUTH'],
    [{ error: { message: 'bad body', type: 'invalid_request_error' } }, 'INVALID_REQUEST'],
    [{ type: 'subscription_quota', message: 'out of credits' }, 'QUOTA'],
  ];
  for (const [body, expected] of cases) {
    let code = 'none';
    try {
      await collect(translateStream(parseSseData(sse([J(body), '[DONE]'])), { model: 'm', status: 200 }));
    } catch (error) {
      code = error.code;
    }
    equal(code, expected, 'an in-band ' + (body.error ? body.error.type : body.type) + ' maps to ' + expected);
  }
  equal(providerFailure(200, J({ error: { message: 'x', type: 'server_error' } }), undefined).code, 'SERVER', 'a 200 carrying an error body is not HTTP_200');
}

process.stdout.write('sign-in poll race\n');
{
  const auth = new QwenAuth({ logger: { debug() {} } });
  const controller = new AuthController({ auth, pool: new AccountPool({ auth }), adapter: { listModels: async () => [] }, provider: 'qwen', logger: { info() {}, warn() {}, debug() {} } });
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const target = String(url);
    if (target.endsWith('/device/code')) return new Response(J({ device_code: 'd', user_code: 'U', expires_in: 600, interval: 1 }), { status: 200, headers: { 'content-type': 'application/json' } });
    if (target.endsWith('/oauth/token')) return new Response(J({ access_token: 'tok', refresh_token: 'ref', expires_in: 900 }), { status: 200, headers: { 'content-type': 'application/json' } });
    if (target.endsWith('/userinfo')) return new Response(J({ sub: 's', email: 'e@x' }), { status: 200, headers: { 'content-type': 'application/json' } });
    return new Response('{}', { status: 404 });
  };
  const started = await controller.dispatch('loginStart', {});
  await new Promise((resolve) => setTimeout(resolve, 1600));
  const first = await controller.dispatch('loginPoll', { flowId: started.value.flowId });
  const second = await controller.dispatch('loginPoll', { flowId: started.value.flowId });
  globalThis.fetch = realFetch;
  equal([first.ok, second.ok], [true, true], 'a second poll after approval still reports the success');
  equal(second.value.state, 'approved', 'the repeated answer is the approved state');
}

process.stdout.write('neighbouring paths\n');
{
  await writeFile(process.env.DSH_QWEN_AUTH_FILE, J({ version: 2, accounts: [
    { id: 'a1', tokens: liveTokens('t1') },
    { id: 'a2', tokens: liveTokens('t2') },
  ] }));
  const auth = new QwenAuth({ logger: { debug() {} } });
  const pool = new AccountPool({ auth, logger: { warn() {} } });
  const adapter = new QwenAdapter({ auth, pool, logger: { warn() {} } });

  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { calls += 1; return new Response('{}', { status: 200 }); };
  let code = 'none';
  try {
    await collect(adapter.stream({ provider: 'qwen', model: 'm', messages: [], signal: controller.signal }));
  } catch (error) {
    code = error.code;
  }
  globalThis.fetch = realFetch;
  equal([code, calls], ['ABORTED', 0], 'an already-aborted request fails before any transport');

  pool.markFailure('a1', { code: 'RATE_LIMIT', failure: { providerRetryAfterMs: 1 } });
  ok(pool.cooldownOf('a1') !== undefined, 'a fresh cooldown is reported');
  await new Promise((resolve) => setTimeout(resolve, 20));
  equal(pool.cooldownOf('a1'), undefined, 'an expired cooldown clears itself');

  const empty = new QwenAdapter({ auth: new QwenAuth({ logger: { debug() {} } }), pool: new AccountPool({ auth: { state: async () => undefined } }) });
  let missing = 'none';
  try {
    await collect(empty.stream({ provider: 'qwen', model: 'm', messages: [] }));
  } catch (error) {
    missing = error.code;
  }
  equal(missing, 'MISSING_CREDENTIAL', 'an empty pool fails with MISSING_CREDENTIAL');
}

await rm(dir, { recursive: true, force: true });
process.stdout.write('\n' + String(checks) + ' regression checks passed\n');
