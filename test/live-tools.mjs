/**
 * Live tool-call round trip through the subscription route: the model must emit a
 * tool call the harness can execute, and must answer the tool result.
 *
 *   node test/live-tools.mjs [model]
 */
import assert from 'node:assert/strict'
import { QwenAdapter } from '../lib/adapter.js'
import { QwenAuth } from '../lib/auth.js'

const model = process.argv[2] ?? 'qwen3.8-flash'
const adapter = new QwenAdapter({ auth: new QwenAuth({ logger: { debug() {} } }) });
const tools = [{
  name: 'add',
  description: 'Add two integers',
  parameters: { type: 'object', properties: { a: { type: 'integer' }, b: { type: 'integer' } }, required: ['a', 'b'] },
}];

async function collect(options) {
  const chunks = [];
  for await (const chunk of adapter.stream(options)) chunks.push(chunk);
  return chunks;
}

const userTurn = { role: 'user', content: [{ type: 'text', text: 'Use the add tool for 2 and 3. Call it exactly once, then report the number.' }] };
const first = await collect({ provider: 'qwen', model, messages: [userTurn], tools, reasoningEffort: 'off', maxTokens: 256 });
const callEnd = first.filter((chunk) => chunk.type === 'block-end' && chunk.block.type === 'tool-call');
assert.equal(callEnd.length, 1, 'the model emitted exactly one tool call');
const call = callEnd[0].block;
assert.equal(call.name, 'add', 'the tool call names the declared tool');
const args = JSON.parse(call.arguments);
assert.equal(args.a, 2, 'the arguments carry the first value');
assert.equal(args.b, 3, 'the arguments carry the second value');
process.stdout.write('  ok  tool call: ' + call.name + ' ' + call.arguments + '\n');
assert.ok(typeof call.id === 'string' && call.id.length > 0, 'the tool call carries a usable id');

const second = await collect({
  provider: 'qwen',
  model,
  tools,
  reasoningEffort: 'off',
  maxTokens: 256,
  messages: [
    userTurn,
    { role: 'assistant', content: [{ type: 'text', text: '' }, call] },
    { role: 'tool', toolCallId: call.id, content: [{ type: 'text', text: '5' }] },
  ],
});
const text = second.filter((chunk) => chunk.type === 'text-delta').map((chunk) => chunk.text).join('');
assert.ok(text.includes('5'), 'the model answered the tool result, got: ' + JSON.stringify(text.slice(0, 120)));
const secondFinish = second[second.length - 1];
assert.equal(secondFinish.type, 'finish', 'the second turn ended with a finish chunk');
assert.notEqual(secondFinish.reason.kind, 'error', 'the second turn did not fail: ' + JSON.stringify(secondFinish.reason));
process.stdout.write('  ok  tool result answered: ' + JSON.stringify(text.slice(0, 120)) + '\n');
process.stdout.write('live tool round trip passed\n');
