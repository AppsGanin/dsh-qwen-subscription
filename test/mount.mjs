/**
 * Mount the plugin against a stub context, the way the harness does: import the
 * entry module, call `apply(ctx, config)`, and inspect the adapter and the
 * `/qwen-auth` channel it registers.
 *
 *   node test/mount.mjs
 */
import assert from 'node:assert/strict'
import * as plugin from '../lib/index.js'

const registered = [];
const channels = [];
const events = [];
const warnings = [];
const disposers = [];

const connection = {
  rpc: {
    handle(channel, handler) {
      channels.push({ channel, handler });
      return async () => {};
    },
  },
};

function childContext() {
  return {
    get(name) {
      return name === 'connection' ? connection : undefined;
    },
    effect(callback) {
      const dispose = callback();
      disposers.push(dispose);
      return dispose;
    },
  };
}

const ctx = {
  get() {
    return undefined;
  },
  effect(callback) {
    const dispose = callback();
    if (typeof dispose === 'function') dispose();
    return dispose;
  },
  emit(event, payload) {
    events.push({ event, payload });
  },
  inject(names, callback) {
    for (const name of names) {
      if (name === 'connection') callback(childContext());
    }
  },
  logger: {
    debug(message) { process.stdout.write('debug: ' + message + '\n'); },
    info(message) { process.stdout.write('info: ' + message + '\n'); },
    warn(message) { warnings.push(message); },
    error(message) { process.stdout.write('error: ' + message + '\n'); },
  },
  llm: {
    registerAdapter(routes, adapter) {
      registered.push({ routes, adapter });
      return Object.assign(() => {}, { replace() {} });
    },
  },
};

assert.equal(plugin.name, 'dsh-llm-qwen-subscription', 'the plugin name is its package name');
assert.deepEqual(plugin.inject, ['llm'], 'the plugin injects the LLM service');
plugin.apply(ctx, {});

assert.equal(registered.length, 1, 'apply registers exactly one adapter');
const entry = registered[0];
assert.deepEqual(entry.routes, ['qwen'], 'the default route is qwen');
assert.equal(entry.adapter.providerInfo('qwen').id, 'qwen', 'provider metadata preserves the route id');
assert.equal(typeof entry.adapter.pool.candidates, 'function', 'the adapter owns an account pool');
const models = await entry.adapter.listModels('qwen');
assert.ok(models.length >= 3, 'the adapter advertises at least three models');
assert.ok(models.every((model) => model.provider === 'qwen'), 'every advertised model is owned by the route');
const info = await entry.adapter.resolveModel('qwen', models[0].id);
assert.ok(info.context.contextWindow > 0, 'resolved metadata carries a context window');
const prepared = await entry.adapter.prepareCall('qwen', models[0].id);
assert.equal(prepared.model.id, models[0].id, 'prepareCall binds the exact model');
process.stdout.write('  ok  plugin mounts, registers qwen, and advertises ' + String(models.length) + ' models\n');

assert.equal(channels.length, 1, 'apply registers exactly one RPC channel');
assert.equal(channels[0].channel, '/qwen-auth', 'the settings channel is /qwen-auth');
const guarded = entry.adapter;
assert.equal(typeof guarded.stream, 'function', 'the registered adapter keeps its stream entry point');
assert.equal(guarded.imageRequestPricing('qwen', 'qwen4-max'), undefined, 'the registered adapter prices images as the base class does');
const unknown = guarded.someFutureMember;
assert.equal(typeof unknown, 'function', 'an unknown adapter member answers a function instead of crashing the runtime');
assert.equal(unknown('qwen'), undefined, 'the unknown member no-ops');
assert.ok(warnings.some((line) => line.includes('someFutureMember')), 'the unknown member is reported once');
process.stdout.write('  ok  unknown adapter members are guarded and reported\n');
const status = await channels[0].handler('status', {});
assert.equal(status.ok, true, 'the channel answers status');
assert.ok(Array.isArray(status.value.accounts), 'status carries an account list');
assert.ok(Array.isArray(status.value.models) && status.value.models.length >= 3, 'status carries the advertised models');
const refused = await channels[0].handler('nope', {});
assert.equal(refused.ok, false, 'an unknown endpoint answers a business failure');
process.stdout.write('  ok  the /qwen-auth channel answers status and refuses unknown endpoints\n');

if (warnings.length > 0) process.stdout.write('  note  startup warning: ' + warnings.join(' | ') + '\n');
process.stdout.write('mount checks passed\n');