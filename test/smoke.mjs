/**
 * Acceptance checks for the Qwen subscription plugin.
 *
 *   node test/smoke.mjs          offline checks: serialization, translation, failures
 *   node test/smoke.mjs --live   also stream one real request through the adapter
 */
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
import { buildRequestBody, prepareMessages, serializeTools } from '../lib/wire.js'
import { translateStream, tokenUsageOf, finishReasonOf } from '../lib/translate.js'
import { QwenFailure, providerFailure } from '../lib/errors.js'
import { parseSseData } from '../lib/sse.js'
import { QwenAdapter } from '../lib/adapter.js'
import { QwenAuth, authFilePath, readAuthState } from '../lib/auth.js'

const here = dirname(fileURLToPath(import.meta.url))
const live = process.argv.includes('--live')
let checks = 0

/** Assert one expectation and count it. */
function ok(condition, label) {
  checks += 1
  assert.ok(condition, label)
  process.stdout.write('  ok  ' + label + '\n')
}

function equal(actual, expected, label) {
  checks += 1
  assert.deepEqual(actual, expected, label)
  process.stdout.write('  ok  ' + label + '\n')
}

async function collect(iterable) {
  const chunks = []
  for await (const chunk of iterable) chunks.push(chunk)
  return chunks
}

function sseOf(events) {
  return (async function* () {
    const encoder = new TextEncoder()
    for (const event of events) yield encoder.encode('data: ' + event + '\n\n')
  })()
}

process.stdout.write('serialization\n')
const messages = await prepareMessages({
  system: 'be brief',
  messages: [
    { role: 'developer', content: [{ type: 'tool-addition', toolName: 'x' }] },
    { role: 'user', content: [{ type: 'text', text: 'hi' }] },
    {
      role: 'assistant',
      content: [
        { type: 'reasoning', text: 'think' },
        { type: 'text', text: 'calling' },
        { type: 'tool-call', id: 'call_1', name: 'ping', arguments: '{"n":1}' },
      ],
    },
    { role: 'tool', toolCallId: 'call_1', content: [{ type: 'text', text: 'pong' }] },
  ],
});
equal(messages.length, 4, 'developer tool-update messages do not reach the wire');
equal(messages[0], { role: 'system', content: 'be brief' }, 'one-shot system text becomes a system message');
equal(messages[1], { role: 'user', content: 'hi' }, 'text-only user content stays a plain string');
equal(messages[2].tool_calls[0].function.name, 'ping', 'assistant tool calls are replayed');
equal(messages[2].reasoning_content, 'think', 'assistant reasoning is replayed for thinking models');
equal(messages[3], { role: 'tool', tool_call_id: 'call_1', content: 'pong' }, 'tool results keep their call id');

const body = buildRequestBody({
  provider: 'qwen',
  model: 'qwen4-max',
  messages,
  reasoningEffort: 'high',
  maxTokens: 1234,
  temperature: 0.2,
  stop: ['END'],
  tools: [{ name: 'ping', description: 'p', parameters: { type: 'object', properties: {} } }],
}, messages, {});
equal(body.stream, true, 'requests stream');
equal(body.stream_options, { include_usage: true }, 'requests usage on the stream');
equal(body.max_tokens, 1234, 'explicit output cap is sent');
equal(body.enable_thinking, true, 'a named effort enables thinking');
equal(body.reasoning_effort, 'high', 'the named effort is forwarded');
equal(body.stop, ['END'], 'stop sequences are forwarded');
const offBody = buildRequestBody({ provider: 'qwen', model: 'qwen4-max', messages, reasoningEffort: 'off' }, messages, {});
equal([offBody.enable_thinking, offBody.reasoning_effort], [false, 'none'], 'the off effort disables thinking');
ok(serializeTools([]).length === 0, 'no tools serialize to an empty list');

process.stdout.write('translation\n')
const streamChunks = await collect(translateStream(parseSseData(sseOf([
  JSON.stringify({ id: 'c1', choices: [{ index: 0, delta: { reasoning_content: 'plan' } }] }),
  JSON.stringify({ id: 'c1', choices: [{ index: 0, delta: { content: 'hello ' } }] }),
  JSON.stringify({ id: 'c1', choices: [{ index: 0, delta: { content: 'world' } }] }),
  JSON.stringify({ id: 'c1', choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_a', function: { name: 'ping', arguments: '{"n":' } }] } }] }),
  JSON.stringify({ id: 'c1', choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '2}' } }] }, finish_reason: 'tool_calls' }] }),
  JSON.stringify({ id: 'c1', choices: [], usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120, prompt_tokens_details: { cached_tokens: 40 }, completion_tokens_details: { reasoning_tokens: 5 } } }),
  '[DONE]',
])), { model: 'qwen4-max' }));
const starts = streamChunks.filter((chunk) => chunk.type === 'block-start')
equal(starts.map((chunk) => chunk.blockType), ['reasoning', 'text', 'tool-call'], 'reasoning, text, and tool-call blocks open in order');
const ends = streamChunks.filter((chunk) => chunk.type === 'block-end')
equal(ends.length, 3, 'every block closes exactly once');
equal(ends[1].block, { type: 'text', text: 'hello world' }, 'text deltas assemble into one block');
equal(ends[2].block, { type: 'tool-call', id: 'call_a', name: 'ping', arguments: '{"n":2}' }, 'tool arguments are reassembled');
const usageChunk = streamChunks.find((chunk) => chunk.type === 'usage')
equal(usageChunk.usage, { inputTokens: 60, outputTokens: 20, totalTokens: 120, cacheReadTokens: 40, reasoningTokens: 5 }, 'token accounting stays disjoint');
const finish = streamChunks[streamChunks.length - 1]
equal(finish.type, 'finish', 'the stream ends with one finish chunk');
equal(finish.reason, { kind: 'tool-calls' }, 'a tool_calls stop reason becomes tool-calls');
equal(streamChunks.filter((chunk) => chunk.type === 'finish').length, 1, 'exactly one finish chunk');
equal(finishReasonOf('length'), { kind: 'max-tokens' }, 'length maps to max-tokens');
equal(finishReasonOf('stop'), { kind: 'stop' }, 'stop maps to stop');
equal(tokenUsageOf({ prompt_tokens: 5, completion_tokens: 1 }), { inputTokens: 5, outputTokens: 1 }, 'usage without cache details is still disjoint');

process.stdout.write('failures\n')
const auth401 = providerFailure(401, '{"error":{"message":"bad token"}}', undefined);
equal(auth401.code, 'AUTH', '401 maps to AUTH');
ok(auth401.failure.code === 'AUTH' && auth401.failure.status === 401, 'the failure snapshot carries the code and status');
equal(providerFailure(429, '', undefined).code, 'RATE_LIMIT', '429 maps to RATE_LIMIT');
equal(providerFailure(402, '', undefined).code, 'QUOTA', '402 maps to QUOTA');
equal(providerFailure(400, '{"type":"subscription_quota"}', undefined).code, 'QUOTA', 'a subscription_quota refusal maps to QUOTA');
equal(providerFailure(400, '{"error":{"message":"maximum context length is 1000000"}}', undefined).code, 'CONTEXT_WINDOW_EXCEEDED', 'a context refusal maps to CONTEXT_WINDOW_EXCEEDED');
equal(providerFailure(503, '', undefined).code, 'SERVER', '5xx maps to SERVER');
equal(providerFailure(418, '', undefined).code, 'HTTP_418', 'other statuses keep their HTTP code');
const retryHeaders = new Headers({ 'retry-after': '7', 'x-request-id': 'req-1' });
const rateLimited = providerFailure(429, '', retryHeaders);
equal(rateLimited.failure.providerRetryAfterMs, 7000, 'retry-after becomes a provider delay');
equal(rateLimited.failure.requestId, 'req-1', 'the gateway request id is preserved');

process.stdout.write('adapter surface\n')
const signedOutAdapter = new QwenAdapter({ auth: { accessToken: async () => { throw new QwenFailure('not signed in', { code: 'MISSING_CREDENTIAL' }) } } });
equal(signedOutAdapter.providerInfo('qwen'), { id: 'qwen', name: 'Qwen (qwen.ai subscription)' }, 'provider metadata keeps the registered route id');
equal(signedOutAdapter.providerRetryPolicy('qwen'), undefined, 'the route keeps harness retry defaults');
const offlineModels = await signedOutAdapter.listModels('qwen');
equal(offlineModels.map((model) => model.id), ['qwen4-max', 'qwen3.8-max', 'qwen3.8-flash'], 'a signed-out catalog still offers the known models');
const resolved = await signedOutAdapter.resolveModel('qwen', 'qwen4-max');
equal(resolved.context.contextWindow, 1000000, 'the catalog context window is advertised');
equal(resolved.reasoning.efforts.map((effort) => effort.id), ['off', 'low', 'medium', 'high'], 'reasoning efforts are advertised');
await assert.rejects(
  collect(signedOutAdapter.stream({ provider: 'qwen', model: 'qwen4-max', messages: [] })),
  (error) => error instanceof QwenFailure && error.code === 'MISSING_CREDENTIAL',
  'a signed-out stream fails with MISSING_CREDENTIAL');
checks += 1
process.stdout.write('  ok  a signed-out stream fails with MISSING_CREDENTIAL\n')

process.stdout.write('sse framing\n')
const splitSse = await collect(parseSseData((async function* () {
  const encoder = new TextEncoder()
  yield encoder.encode('data: {"a":1}\r\n\r\n');
  yield encoder.encode('data: {"b":');
  yield encoder.encode('2}\n\ndata: [DONE]\n\n');
})()));
equal(splitSse, ['{"a":1}', '{"b":2}', '[DONE]'], 'events survive chunk and CRLF boundaries');

if (live) {
  process.stdout.write('live stream (' + authFilePath() + ')\n')
  const state = await readAuthState()
  if (state === undefined) throw new Error('--live needs a signed-in credential store; run dsh-qwen-login first')
  const auth = new QwenAuth({ logger: { debug() {} } });
  const adapter = new QwenAdapter({ auth });
  const model = process.env.DSH_QWEN_LIVE_MODEL ?? 'qwen3.8-flash';
  const chunks = await collect(adapter.stream({
    provider: 'qwen',
    model,
    messages: [{ role: 'user', content: [{ type: 'text', text: 'Reply with exactly: qwen-ok' }] }],
    reasoningEffort: 'off',
    maxTokens: 64,
  }));
  const text = chunks.filter((chunk) => chunk.type === 'text-delta').map((chunk) => chunk.text).join('');
  const usage = chunks.find((chunk) => chunk.type === 'usage');
  ok(text.length > 0, 'the live reply produced text: ' + JSON.stringify(text.slice(0, 80)));
  ok(usage !== undefined && usage.usage.inputTokens > 0, 'the live reply reported usage: ' + JSON.stringify(usage === undefined ? null : usage.usage));
  equal(chunks[chunks.length - 1].type, 'finish', 'the live stream ended with a finish chunk');
}

process.stdout.write('\n' + String(checks) + ' checks passed' + (live ? ' (live included)' : '') + '\n');
