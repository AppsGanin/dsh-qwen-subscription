/**
 * Mount check for the browser half of dsh-llm-qwen-subscription.
 *
 * The bundle is loaded exactly the way the host loads it: a CommonJS factory
 * handed to window.__ModuleLoader__.load, with only 'react' requireable.
 * react-dom is not installed in the desktop profile, so the section is
 * rendered by a small hooks-capable walker that installs a real React
 * dispatcher, runs effects and repeats the pass until state stops changing.
 *
 *   node test/client-mount.mjs
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const BUNDLE = join(HERE, '..', 'lib', 'client.js');
const MODULE_ID = 'dsh-llm-qwen-subscription';
const CHANNEL = '/api';
const METHOD_PREFIX = 'qwen-auth.';
const ENDPOINTS = ['status', 'loginStart', 'loginPoll', 'loginCancel', 'signOut', 'prefer', 'test'];

/**
 * Full RPC method name of one endpoint.
 * @param endpoint - bare endpoint name.
 * @returns the method as the Node half expects it.
 */
const method = (endpoint) => METHOD_PREFIX + endpoint;
const ENDPOINT = 'https://api.qwen.ai/compatible-mode/v1';

let passed = 0;
let failed = 0;

/**
 * Run one named check and print exactly one line for it.
 * @param label - what the check proves.
 * @param body - the check itself, sync or async.
 */
async function check(label, body) {
  try {
    await body();
    passed += 1;
    process.stdout.write('  ok  ' + label + '\n');
  } catch (error) {
    failed += 1;
    process.exitCode = 1;
    const message = error && error.message ? error.message : String(error);
    process.stdout.write('  FAIL ' + label + ': ' + message + '\n');
  }
}

/** Harness home that holds the profiles; overridable for non-default installs. */
const DSH_HOME = process.env.DSH_HOME ?? join(homedir(), '.dsh');

/**
 * Load react from a harness profile, the same instance the host hands plugins.
 * @returns the react module.
 */
function loadReact() {
  const candidates = [
    process.env.DSH_PROFILE_NODE_MODULES,
    join(DSH_HOME, 'profiles', 'desktop', 'node_modules') + '/',
    join(DSH_HOME, 'profiles', 'web', 'node_modules') + '/',
    join(HERE, '..', 'node_modules') + '/',
  ].filter((value) => typeof value === 'string' && value.length > 0);
  for (const candidate of candidates) {
    try {
      const scoped = createRequire(candidate.endsWith('/') ? candidate : candidate + '/');
      return scoped('react');
    } catch (error) {
      void error;
    }
  }
  throw new Error('react was not found; install a harness profile with react or set DSH_PROFILE_NODE_MODULES (tried ' + candidates.join(', ') + ')');
}

const React = loadReact();
const h = React.createElement;

const EMPTY_STATUS = {
  provider: 'qwen',
  signedIn: false,
  authFile: '/home/user/.dsh/plugins/qwen-subscription/auth.json',
  endpoint: ENDPOINT,
  accounts: [],
  models: [],
};

const SIGNED_STATUS = {
  provider: 'qwen',
  signedIn: true,
  authFile: '/home/user/.dsh/plugins/qwen-subscription/auth.json',
  endpoint: ENDPOINT,
  accounts: [{
    id: 'acc_1a2b',
    label: 'user@example.com',
    name: 'Дмитрий Ганин',
    memberType: 'pro',
    expiresAt: '2026-11-26T11:50:13.094Z',
    preferred: true,
    cooldownUntil: null,
    quota: {
      exhausted: true,
      memberType: 'pro',
      resetAt: '2026-12-01T00:00:00.000Z',
      observedAt: '2026-11-26T12:00:00.000Z',
    },
  }],
  models: [{ id: 'qwen4-max', name: 'Qwen4 Max' }],
};

const SECONDARY_STATUS = {
  provider: 'qwen',
  signedIn: true,
  endpoint: ENDPOINT,
  accounts: [{
    id: 'acc_9f9f',
    label: 'second@example.com',
    name: 'Второй аккаунт',
    memberType: 'free',
    expiresAt: '2026-11-27T09:00:00.000Z',
    preferred: false,
    cooldownUntil: '2026-11-26T13:00:00.000Z',
    quota: null,
  }],
  models: [],
};

/** Every RPC call made by any fake caller, for the contract-wide assertion. */
const allCalls = [];

/**
 * Build an RPC caller shaped like connection.rpc.
 * @param handlers - endpoint name to handler; unknown endpoints answer an error.
 * @returns an object with a call method and the recorded calls.
 */
function createRpc(handlers) {
  const calls = [];
  return {
    calls,
    call(channel, endpoint, payload) {
      const entry = { channel, endpoint, payload };
      calls.push(entry);
      allCalls.push(entry);
      const bare = typeof endpoint === 'string' && endpoint.startsWith(METHOD_PREFIX)
        ? endpoint.slice(METHOD_PREFIX.length)
        : String(endpoint);
      const handler = handlers[bare];
      if (typeof handler !== 'function') {
        return Promise.resolve({ ok: false, error: { code: 'BAD_REQUEST', message: 'неизвестный эндпоинт ' + endpoint } });
      }
      try {
        return Promise.resolve(handler(payload || {}, calls.filter((item) => item.endpoint === endpoint).length));
      } catch (error) {
        return Promise.reject(error);
      }
    },
  };
}

/**
 * A tiny hooks-capable renderer. It installs a real React dispatcher while it
 * calls a function component, so React.useState / useEffect / useRef work
 * outside react-dom, then walks the returned element tree into text and host
 * nodes.
 * @param ReactRuntime - the react module the bundle received.
 * @returns mount / pass / text / nodes / find helpers / click / unmount.
 */
function createRenderer(ReactRuntime) {
  const internals = ReactRuntime.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED;
  assert.ok(internals && internals.ReactCurrentDispatcher, 'the react build exposes no dispatcher slot');
  const dispatcherStack = internals.ReactCurrentDispatcher;
  const realSetTimeout = globalThis.setTimeout;
  const instances = new Map();
  let rootElement = null;
  let frame = null;
  let dirty = false;
  let pendingEffects = [];
  let view = { text: '', nodes: [] };

  const later = (ms) => new Promise((resolve) => realSetTimeout(resolve, ms));

  function instanceFor(key) {
    let instance = instances.get(key);
    if (!instance) {
      instance = { hooks: [] };
      instances.set(key, instance);
    }
    return instance;
  }

  function slotFor(index, kind) {
    const slot = frame.instance.hooks[index] || { kind: kind };
    frame.instance.hooks[index] = slot;
    return slot;
  }

  function changed(slot, deps) {
    if (!slot.initialized) return true;
    if (deps === undefined) return true;
    const previous = slot.deps;
    if (!previous || previous.length !== deps.length) return true;
    for (let index = 0; index < deps.length; index += 1) {
      if (!Object.is(previous[index], deps[index])) return true;
    }
    return false;
  }

  const dispatcher = {
    useState(initial) {
      const slot = slotFor(frame.index, 'state');
      frame.index += 1;
      if (!('value' in slot)) slot.value = typeof initial === 'function' ? initial() : initial;
      const setValue = (next) => {
        const value = typeof next === 'function' ? next(slot.value) : next;
        if (Object.is(value, slot.value)) return;
        slot.value = value;
        dirty = true;
      };
      return [slot.value, setValue];
    },
    useRef(initial) {
      const slot = slotFor(frame.index, 'ref');
      frame.index += 1;
      if (!('ref' in slot)) slot.ref = { current: initial };
      return slot.ref;
    },
    useEffect(effect, deps) {
      const slot = slotFor(frame.index, 'effect');
      frame.index += 1;
      if (changed(slot, deps)) pendingEffects.push({ slot, effect });
      slot.initialized = true;
      slot.deps = deps === undefined ? undefined : deps.slice();
    },
    useLayoutEffect(effect, deps) {
      dispatcher.useEffect(effect, deps);
    },
    useMemo(factory, deps) {
      const slot = slotFor(frame.index, 'memo');
      frame.index += 1;
      if (changed(slot, deps)) slot.value = factory();
      slot.initialized = true;
      slot.deps = deps === undefined ? undefined : deps.slice();
      return slot.value;
    },
    useCallback(callback, deps) {
      const slot = slotFor(frame.index, 'callback');
      frame.index += 1;
      if (changed(slot, deps)) slot.value = callback;
      slot.initialized = true;
      slot.deps = deps === undefined ? undefined : deps.slice();
      return slot.value;
    },
  };

  function runEffects() {
    const queue = pendingEffects;
    pendingEffects = [];
    for (const entry of queue) {
      if (typeof entry.slot.cleanup === 'function') {
        entry.slot.cleanup();
        entry.slot.cleanup = null;
      }
      const result = entry.effect();
      entry.slot.cleanup = typeof result === 'function' ? result : null;
    }
  }

  function renderComponent(type, props, key) {
    const instance = instanceFor(key);
    const previousFrame = frame;
    const previousDispatcher = dispatcherStack.current;
    const nextFrame = { instance, index: 0 };
    frame = nextFrame;
    dispatcherStack.current = dispatcher;
    let output;
    try {
      output = type(props);
    } finally {
      dispatcherStack.current = previousDispatcher;
      frame = previousFrame;
    }
    return output;
  }

  function renderNode(node, key) {
    if (node === null || node === undefined || node === true || node === false) {
      return { text: '', nodes: [] };
    }
    if (typeof node === 'string' || typeof node === 'number') {
      return { text: String(node), nodes: [] };
    }
    if (Array.isArray(node)) {
      const parts = [];
      const nodes = [];
      node.forEach((child, index) => {
        const rendered = renderNode(child, key + '/' + index);
        if (rendered.text.length > 0) parts.push(rendered.text);
        nodes.push(...rendered.nodes);
      });
      return { text: parts.join(' '), nodes };
    }
    if (typeof node !== 'object') return { text: '', nodes: [] };
    const type = node.type;
    const props = node.props || {};
    if (typeof type === 'function') {
      const name = key + ':' + (type.name || 'component');
      return renderNode(renderComponent(type, props, name), name);
    }
    const children = renderNode(props.children, key);
    return {
      text: children.text,
      nodes: [{ tag: String(type), props, text: children.text }, ...children.nodes],
    };
  }

  async function pass() {
    for (let iteration = 0; iteration < 80; iteration += 1) {
      dirty = false;
      view = renderNode(rootElement, 'root');
      runEffects();
      for (let tick = 0; tick < 4; tick += 1) await later(0);
      if (!dirty) return;
    }
    throw new Error('the section kept re-rendering: effects never settled');
  }

  async function mount(element) {
    rootElement = element;
    await pass();
  }

  function findButton(label) {
    return view.nodes.filter((node) => node.tag === 'button' && node.text === label)[0] || null;
  }

  function findLink(label) {
    return view.nodes.filter((node) => node.tag === 'a' && node.text === label)[0] || null;
  }

  function findInput(placeholder) {
    return view.nodes.filter((node) => node.tag === 'input' && node.props.placeholder === placeholder)[0] || null;
  }

  async function type(placeholder, value) {
    const target = findInput(placeholder);
    if (!target) throw new Error('input not found: ' + placeholder);
    if (typeof target.props.onChange !== 'function') throw new Error('input is not editable: ' + placeholder);
    target.props.onChange({ target: { value } });
    await pass();
  }

  async function click(label) {
    const target = findButton(label);
    if (!target) throw new Error('button not found: ' + label);
    if (typeof target.props.onClick !== 'function') throw new Error('button is not clickable: ' + label);
    target.props.onClick();
    await pass();
  }

  function unmount() {
    for (const instance of instances.values()) {
      for (const slot of instance.hooks) {
        if (slot && typeof slot.cleanup === 'function') {
          slot.cleanup();
          slot.cleanup = null;
        }
      }
    }
    instances.clear();
    rootElement = null;
    view = { text: '', nodes: [] };
  }

  return {
    mount,
    pass,
    click,
    unmount,
    findButton,
    findLink,
    findInput,
    type,
    text: () => view.text,
    nodes: () => view.nodes,
  };
}

/**
 * Mount the section against one fake RPC caller.
 * @param section - the registered settings component.
 * @param rpc - fake connection RPC caller.
 * @returns the renderer.
 */
async function mountSection(section, rpc) {
  const renderer = createRenderer(React);
  await renderer.mount(h(section, { rpc, locale }));
  return renderer;
}

/**
 * Run intervals faster than production so the 3 s poll is observable in a test.
 * @returns a function restoring the real timers.
 */
function useFastTimers() {
  const realSetInterval = globalThis.setInterval;
  const realClearInterval = globalThis.clearInterval;
  globalThis.setInterval = (callback) => realSetInterval(callback, 5);
  globalThis.clearInterval = (handle) => realClearInterval(handle);
  return () => {
    globalThis.setInterval = realSetInterval;
    globalThis.clearInterval = realClearInterval;
  };
}

/**
 * Wait for asynchronous work, then let the renderer apply the new state.
 * @param renderer - the mounted renderer.
 * @param rounds - how many sampling rounds to take.
 */
async function settle(renderer, rounds) {
  for (let round = 0; round < rounds; round += 1) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    await renderer.pass();
  }
}

/** The bundle, loaded through the host's module loader shim. */
const requireCalls = [];
const requireStub = (id) => {
  requireCalls.push(id);
  if (id !== 'react') throw new Error('the browser half may only require "react", asked for ' + id);
  return React;
};
const fakeWindow = {};
let registered = null;
fakeWindow.__ModuleLoader__ = {
  load(entry) {
    registered = { id: entry.id, factory: entry.factory, exports: entry.factory(requireStub) };
  },
};
const source = readFileSync(BUNDLE, 'utf8');
new Function('window', source)(fakeWindow);

const bundle = registered && registered.exports ? registered.exports : null;
const connectionRpc = { call: () => Promise.resolve({ ok: true, value: EMPTY_STATUS }) };

/**
 * A minimal host locale service: dictionaries register per namespace, bind reads
 * the active language at call time, and subscribe notifies on a language switch.
 * Starts in Russian so the existing copy assertions hold; a later check flips it
 * to English to prove the card follows the host language live.
 */
function makeLocale(initial) {
  const dicts = {};
  const listeners = new Set();
  let snapshot = { active: initial, revision: 0 };
  return {
    register(ns, entries) { dicts[ns] = entries; return () => { delete dicts[ns]; }; },
    bind(ns) {
      return (key, params) => {
        const table = dicts[ns] || {};
        const active = table[snapshot.active] || {};
        const template = active[key] !== undefined ? active[key] : ((table.en || {})[key] !== undefined ? table.en[key] : key);
        if (!params) return template;
        return template.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match));
      };
    },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    getSnapshot() { return snapshot; },
    setLanguage(id) {
      snapshot = { active: id, revision: snapshot.revision + 1 };
      for (const fn of [...listeners]) fn();
    },
  };
}
const locale = makeLocale('ru');

const registrations = [];
const ctx = {
  get(name) {
    if (name === 'connection') return { rpc: connectionRpc };
    if (name === 'locale') return locale;
    return undefined;
  },
  effect(callback) { return callback(); },
  slots: {
    inject(name, callback) {
      void name;
      return callback();
    },
    register(config, component) {
      registrations.push({ config, component });
      return { config, component };
    },
  },
};

await check('the bundle registers itself under the plugin module id', () => {
  assert.ok(registered, 'window.__ModuleLoader__.load was never called');
  assert.equal(registered.id, MODULE_ID, 'the loader id is the plugin package name');
  assert.equal(typeof registered.factory, 'function', 'the loader entry carries a factory');
});

await check('the factory requires nothing but react', () => {
  assert.deepEqual(requireCalls, ['react'], 'require calls: ' + requireCalls.join(', '));
});

await check('the bundle carries no console calls', () => {
  assert.equal(/console\s*\./.test(source), false, 'the bundle logs to the console');
});

await check('the client half injects slots and connection', () => {
  assert.deepEqual(bundle.inject, ['slots', 'connection']);
  assert.equal(typeof bundle.apply, 'function');
});

await check('apply registers the settings.section card for qwen', () => {
  bundle.apply(ctx);
  assert.equal(registrations.length, 1, 'apply must register exactly one slot entry');
  const { config, component } = registrations[0];
  assert.equal(config.name, 'settings.section');
  assert.equal(config.id, 'qwen');
  assert.equal(config.order, 91);
  assert.equal(typeof config.label, 'function');
  assert.equal(config.label(), 'Qwen');
  assert.equal(typeof component, 'function', 'the slot component is a function component');
});

await check('the slot injection hands the section the connection rpc', () => {
  const injected = registrations[0].config.inject();
  assert.equal(injected.rpc, connectionRpc, 'the card must receive connection.rpc');
});

const section = registrations.length > 0 ? registrations[0].component : null;

if (section === null) {
  process.stdout.write('client-mount checks FAILED: the settings section was never registered\n');
  process.exit(1);
}

await check('without accounts the section offers sign-in and no sign-out', async () => {
  const rpc = createRpc({ status: () => ({ ok: true, value: EMPTY_STATUS }) });
  const renderer = await mountSection(section, rpc);
  try {
    const text = renderer.text();
    assert.ok(text.includes('Qwen (подписка qwen.ai)'), 'title is missing');
    assert.ok(text.includes(ENDPOINT), 'status.endpoint is missing from the description line');
    assert.ok(renderer.findButton('Войти'), 'the sign-in button is missing');
    assert.equal(renderer.findButton('Выйти'), null, 'a sign-out button appears without accounts');
    assert.ok(rpc.calls.some((call) => call.channel === CHANNEL && call.endpoint === method('status')));
  } finally {
    renderer.unmount();
  }
});

await check('a signed-in account shows email, badges, expiry, quota and sign-out', async () => {
  const rpc = createRpc({ status: () => ({ ok: true, value: SIGNED_STATUS }) });
  const renderer = await mountSection(section, rpc);
  try {
    const text = renderer.text();
    assert.ok(text.includes('user@example.com'), 'the account email is missing');
    assert.ok(text.includes('Дмитрий Ганин'), 'the account name is missing');
    assert.ok(text.includes('pro'), 'the member type is missing');
    assert.ok(text.includes('по умолчанию'), 'the preferred badge is missing');
    assert.ok(text.includes('Access-токен до'), 'the access token expiry is missing');
    assert.ok(/\d{2}\.\d{2}\.\d{4}/.test(text), 'the expiry is not formatted as a date');
    assert.ok(renderer.findButton('Выйти'), 'the sign-out button is missing');
    assert.ok(renderer.findButton('Добавить аккаунт'), 'the add-account button is missing');
    const preferred = renderer.findButton('Сделать основным');
    assert.ok(preferred, 'the prefer button is missing');
    assert.equal(preferred.props.disabled, true, 'the preferred account must not be re-preferred');
  } finally {
    renderer.unmount();
  }
});

await check('an exhausted quota renders a red notice with the reset instant', async () => {
  const rpc = createRpc({ status: () => ({ ok: true, value: SIGNED_STATUS }) });
  const renderer = await mountSection(section, rpc);
  try {
    const notice = renderer.nodes().filter((node) => node.text.startsWith('Квота исчерпана'))[0] || null;
    assert.ok(notice, 'the quota notice is missing');
    assert.ok(notice.text.includes('01.12.2026'), 'the notice does not carry quota.resetAt: ' + notice.text);
    assert.ok(String(notice.props.style.border).includes('220,38,38'), 'the quota notice is not red');
  } finally {
    renderer.unmount();
  }
});

await check('a failed status answer shows error.message instead of a crash', async () => {
  const rpc = createRpc({
    status: () => ({ ok: false, error: { code: 'AUTH', message: 'Хранилище недоступно' } }),
  });
  const renderer = await mountSection(section, rpc);
  try {
    assert.ok(renderer.text().includes('Хранилище недоступно'), 'the RPC error message is not shown');
    assert.equal(renderer.findButton('Войти'), null, 'a broken status must not offer sign-in blindly');
  } finally {
    renderer.unmount();
  }
});

await check('a sign-in flow shows the user code, the link and the cancel button', async () => {
  const restore = useFastTimers();
  const rpc = createRpc({
    status: () => ({ ok: true, value: EMPTY_STATUS }),
    loginStart: () => ({
      ok: true,
      value: {
        flowId: 'flow_1a2b',
        userCode: 'DSHH-MSBV',
        url: 'https://chat.qwen.ai/authorize?flow=flow_1a2b',
        expiresAt: new Date(Date.now() + 600000).toISOString(),
      },
    }),
    loginPoll: () => ({ ok: true, value: { state: 'pending' } }),
  });
  const renderer = await mountSection(section, rpc);
  try {
    await renderer.click('Войти');
    assert.ok(renderer.text().includes('DSHH-MSBV'), 'the user code is missing');
    const link = renderer.findLink('Открыть страницу подтверждения');
    assert.ok(link, 'the confirmation link is missing');
    assert.equal(link.props.href, 'https://chat.qwen.ai/authorize?flow=flow_1a2b', 'the link target is wrong');
    assert.ok(renderer.findButton('Отмена'), 'the cancel button is missing');
    assert.equal(rpc.calls.some((call) => call.endpoint === method('loginStart') && call.channel === CHANNEL), true,
      'loginStart was not called as qwen-auth.loginStart on /api');
  } finally {
    renderer.unmount();
    restore();
  }
});

await check('loginPoll sends the flowId and an approval reloads the status', async () => {
  const restore = useFastTimers();
  let statusCalls = 0;
  const rpc = createRpc({
    status: () => {
      statusCalls += 1;
      return { ok: true, value: statusCalls === 1 ? EMPTY_STATUS : SIGNED_STATUS };
    },
    loginStart: () => ({
      ok: true,
      value: {
        flowId: 'flow_1a2b',
        userCode: 'DSHH-MSBV',
        url: 'https://chat.qwen.ai/authorize?flow=flow_1a2b',
        expiresAt: new Date(Date.now() + 600000).toISOString(),
      },
    }),
    loginPoll: () => ({ ok: true, value: { state: 'approved', account: { id: 'acc_1a2b', label: 'user@example.com' } } }),
  });
  const renderer = await mountSection(section, rpc);
  try {
    await renderer.click('Войти');
    await settle(renderer, 6);
    const polls = rpc.calls.filter((call) => call.endpoint === method('loginPoll'));
    assert.ok(polls.length > 0, 'loginPoll was never called');
    assert.equal(polls[0].channel, CHANNEL, 'loginPoll used the wrong channel');
    assert.equal(polls[0].endpoint, 'qwen-auth.loginPoll', 'loginPoll used the wrong method name');
    assert.equal(polls[0].payload.flowId, 'flow_1a2b', 'loginPoll did not send the flowId from loginStart');
    assert.ok(statusCalls >= 2, 'the status was not reloaded after approval');
    assert.ok(renderer.text().includes('user@example.com'), 'the approved account is not listed');
    assert.ok(renderer.findButton('Выйти'), 'the signed-in state is missing after approval');
    assert.equal(renderer.findButton('Отмена'), null, 'the flow card survived the approval');
  } finally {
    renderer.unmount();
    restore();
  }
});

await check('a refused flow is shown as an error and drops the flow card', async () => {
  const restore = useFastTimers();
  const rpc = createRpc({
    status: () => ({ ok: true, value: EMPTY_STATUS }),
    loginStart: () => ({
      ok: true,
      value: {
        flowId: 'flow_bad',
        userCode: 'DSHH-XXXX',
        url: 'https://chat.qwen.ai/authorize?flow=flow_bad',
        expiresAt: new Date(Date.now() + 600000).toISOString(),
      },
    }),
    loginPoll: () => ({ ok: false, error: { code: 'AUTH', message: 'Поток входа истёк' } }),
  });
  const renderer = await mountSection(section, rpc);
  try {
    await renderer.click('Войти');
    await settle(renderer, 6);
    assert.ok(renderer.text().includes('Поток входа истёк'), 'the poll error is not shown');
    assert.equal(renderer.findButton('Отмена'), null, 'the dead flow card is still rendered');
    assert.ok(renderer.findButton('Войти'), 'the sign-in button did not come back');
  } finally {
    renderer.unmount();
    restore();
  }
});

await check('prefer and signOut send the account id and refresh the status', async () => {
  let statusCalls = 0;
  const rpc = createRpc({
    status: () => {
      statusCalls += 1;
      return { ok: true, value: SECONDARY_STATUS };
    },
    prefer: () => ({ ok: true, value: { ok: true } }),
    signOut: () => ({ ok: true, value: { signedOut: 1, revoked: true } }),
  });
  const renderer = await mountSection(section, rpc);
  try {
    await renderer.click('Сделать основным');
    const prefer = rpc.calls.filter((call) => call.endpoint === method('prefer'))[0];
    assert.ok(prefer, 'prefer was never called');
    assert.equal(prefer.channel, CHANNEL, 'prefer used the wrong channel');
    assert.equal(prefer.payload.accountId, 'acc_9f9f', 'prefer sent the wrong account id');
    await renderer.click('Выйти');
    const signOut = rpc.calls.filter((call) => call.endpoint === method('signOut'))[0];
    assert.ok(signOut, 'signOut was never called');
    assert.equal(signOut.payload.accountId, 'acc_9f9f', 'signOut sent the wrong account id');
    assert.ok(statusCalls >= 2, 'the status was not reloaded after prefer and signOut');
  } finally {
    renderer.unmount();
  }
});

await check('every call uses the /api channel and a qwen-auth. method name', () => {
  assert.ok(allCalls.length > 0, 'no RPC call was made at all');
  for (const call of allCalls) {
    assert.equal(call.channel, CHANNEL, 'unexpected channel for method ' + call.endpoint);
    const bare = String(call.endpoint).startsWith(METHOD_PREFIX)
      ? String(call.endpoint).slice(METHOD_PREFIX.length)
      : '';
    assert.equal(ENDPOINTS.includes(bare), true, 'unexpected method name: ' + call.endpoint);
    assert.equal(typeof call.payload, 'object', 'method ' + call.endpoint + ' was called without a payload');
  }
});

await check('the test-connection button calls qwen-auth.test and shows the result', async () => {
  const rpc = createRpc({
    status: () => ({ ok: true, value: EMPTY_STATUS }),
    test: () => ({ ok: true, value: { latencyMs: 123, models: 3, account: 'user@example.com' } }),
  });
  const renderer = await mountSection(section, rpc);
  try {
    assert.ok(renderer.findButton('Проверить соединение'), 'the test-connection button is missing');
    await renderer.click('Проверить соединение');
    await settle(renderer, 3);
    assert.ok(rpc.calls.some((call) => call.endpoint === method('test')), 'qwen-auth.test was not called');
    assert.ok(renderer.text().includes('123'), 'the latency is not shown');
  } finally {
    renderer.unmount();
  }
});

await check('an account note is sent as the login label', async () => {
  const rpc = createRpc({
    status: () => ({ ok: true, value: EMPTY_STATUS }),
    loginStart: () => ({ ok: true, value: { flowId: 'flow_lbl', userCode: 'U-1', url: 'https://chat.qwen.ai/authorize?x=1', expiresAt: new Date(Date.now() + 600000).toISOString() } }),
    loginPoll: () => ({ ok: true, value: { state: 'pending' } }),
  });
  const renderer = await mountSection(section, rpc);
  try {
    assert.ok(renderer.findInput('Необязательная заметка об аккаунте'), 'the account-note input is missing');
    await renderer.type('Необязательная заметка об аккаунте', 'work subscription');
    await renderer.click('Войти');
    const start = rpc.calls.filter((call) => call.endpoint === method('loginStart')).pop();
    assert.ok(start, 'loginStart was not called');
    assert.equal(start.payload.label, 'work subscription', 'loginStart did not receive the note as label');
  } finally {
    renderer.unmount();
  }
});

await check('controls carry accessible labels and the card is focus-scoped', async () => {
  const rpc = createRpc({ status: () => ({ ok: true, value: EMPTY_STATUS }) });
  const renderer = await mountSection(section, rpc);
  try {
    const signIn = renderer.findButton('Войти');
    assert.equal(signIn.props['aria-label'], 'Войти', 'the sign-in button has an aria-label');
    const input = renderer.findInput('Необязательная заметка об аккаунте');
    assert.equal(input.props['aria-label'], 'Необязательная заметка об аккаунте', 'the note input has an aria-label');
    const scoped = renderer.nodes().find((node) => node.props && node.props['data-qwen-card'] !== undefined);
    assert.ok(scoped, 'the card root carries the focus-scope attribute');
  } finally {
    renderer.unmount();
  }
});

await check('an account with usage shows the request/token line', async () => {
  const withUsage = { ...SIGNED_STATUS, accounts: SIGNED_STATUS.accounts.map((a) => ({ ...a, usage: { requests: 7, inputTokens: 1200, outputTokens: 340 } })) };
  const rpc = createRpc({ status: () => ({ ok: true, value: withUsage }) });
  const renderer = await mountSection(section, rpc);
  try {
    const text = renderer.text();
    assert.ok(text.includes('запросов: 7'), 'the usage request count is missing');
    assert.ok(text.includes('1200'), 'the usage input tokens are missing');
  } finally {
    renderer.unmount();
  }
});

await check('switching the host language to English re-renders the card in English', async () => {
  const rpc = createRpc({ status: () => ({ ok: true, value: SIGNED_STATUS }) });
  const renderer = await mountSection(section, rpc);
  try {
    assert.ok(renderer.findButton('Выйти'), 'the card should start in Russian');
    locale.setLanguage('en');
    await settle(renderer, 4);
    const text = renderer.text();
    assert.ok(renderer.findButton('Sign out'), 'the sign-out button did not switch to English');
    assert.ok(renderer.findButton('Add account'), 'the add-account button did not switch to English');
    assert.ok(text.includes('Access token until'), 'the expiry label did not switch to English');
    assert.equal(renderer.findButton('Выйти'), null, 'Russian copy survived the language switch');
    locale.setLanguage('ru');
    await settle(renderer, 4);
    assert.ok(renderer.findButton('Выйти'), 'the card did not switch back to Russian');
    locale.setLanguage('zh');
    await settle(renderer, 4);
    assert.ok(renderer.findButton('退出'), 'the card did not switch to Chinese');
    assert.ok(renderer.text().includes('访问令牌至'), 'the Chinese expiry label is missing');
    locale.setLanguage('ru');
    await settle(renderer, 4);
  } finally {
    renderer.unmount();
  }
});

if (failed === 0) {
  process.stdout.write('client-mount checks passed: ' + passed + ' checks\n');
} else {
  process.stdout.write('client-mount checks FAILED: ' + failed + ' of ' + (passed + failed) + ' checks\n');
}

// A stray interval must never keep the process alive.
const guard = setTimeout(() => {
  process.exit(process.exitCode || 0);
}, 1500);
guard.unref();
