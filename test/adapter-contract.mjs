/**
 * Adapter contract checks: every member the harness `LlmAdapter` base class
 * defines must exist on this duck-typed adapter, because the runtime calls some
 * of them (image pricing during compaction, for one) outside `stream`.
 *
 *   node test/adapter-contract.mjs
 */
import assert from 'node:assert/strict'
import { QwenAdapter } from '../lib/adapter.js'

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

/**
 * The complete `LlmAdapter` surface of DSH 0.2.2: the abstract `stream` plus
 * every concrete member whose default an implementation inherits. Keep this list
 * in step with `@deepseek-ai/dsh-llm/src/index.ts`; a member missing here is a
 * member the runtime may call and this adapter would not answer.
 */
const BASE_MEMBERS = [
  'providerInfo',
  'providerRetryPolicy',
  'imageRequestPricing',
  'imageRequestTarget',
  'listModels',
  'resolveModel',
  'prepareCall',
  'stream',
];

const signedOut = { accessToken: async () => { throw new Error('signed out'); } };
const adapter = new QwenAdapter({ auth: signedOut });

process.stdout.write('surface\n');
for (const member of BASE_MEMBERS) {
  ok(typeof adapter[member] === 'function', 'the adapter implements ' + member + '()');
}

process.stdout.write('defaults the harness relies on\n');
equal(adapter.providerInfo('qwen'), { id: 'qwen', name: 'Qwen (qwen.ai subscription)' }, 'providerInfo keeps the registered route id');
equal(adapter.providerRetryPolicy('qwen'), undefined, 'providerRetryPolicy leaves the harness defaults in place');
equal(adapter.imageRequestPricing('qwen', 'qwen4-max'), undefined, 'imageRequestPricing declares no route-owned pricing');
const image = { attachmentId: 'att_1', mediaType: 'image/png', bytes: 4096, width: 800, height: 600 };
equal(adapter.imageRequestTarget('qwen', 'qwen4-max', image), { width: 800, height: 600, maxBytes: 4096 }, 'imageRequestTarget sends the image unchanged');

process.stdout.write('compaction-style call path\n');
// The compaction that failed asked the adapter to price a request image while
// the route was not yet the current model; the call must answer, not throw.
const requestedPricing = adapter.imageRequestPricing('qwen', 'qwen3.8-flash');
ok(requestedPricing === undefined || typeof requestedPricing.priceImages === 'function', 'image pricing answers a usable value even for an unlisted model');
const prepared = await adapter.prepareCall('qwen', 'qwen4-max');
equal(prepared.model.id, 'qwen4-max', 'prepareCall resolves the exact model');
ok(typeof prepared.stream === 'function', 'prepareCall returns a dispatch entry point');
const models = await adapter.listModels('qwen');
ok(models.length >= 3, 'listModels advertises the catalog');
ok(models.every((model) => model.badge && typeof model.badge.text.en === 'string'), 'every model carries a localized context badge');
ok(models[0].badge.text.en.includes('context'), 'the badge names the context window');
const resolved = await adapter.resolveModel('qwen', 'qwen4-max');
ok(resolved.context.contextWindow > 0, 'resolveModel answers metadata');

process.stdout.write('\n' + String(checks) + ' adapter contract checks passed\n');
