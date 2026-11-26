window.__ModuleLoader__.load({ id: "dsh-llm-qwen-subscription", factory: (require) => {
var module = { exports: {} }; var exports = module.exports;
const React = require("react");
/*
 * dsh-llm-qwen-subscription — browser half.
 *
 * The host loads this file as a CommonJS factory, so only `react` may be
 * required and the source stays a plain script: no JSX, no ESM syntax. It
 * registers one settings card that signs the account in to the qwen.ai
 * subscription over the host's `/api` channel, method prefix `qwen-auth.`, and
 * lists the accounts of the failover pool. All copy is localized through the
 * host locale service (English and Russian), with a built-in fallback.
 */
const h = React.createElement;

/** RPC channel of the host connection service. */
const CHANNEL = '/api';

/** Method prefix the Node half of the plugin answers on that channel. */
const METHOD_PREFIX = 'qwen-auth.';

/** Poll cadence of an open device flow, in milliseconds. */
const POLL_INTERVAL_MS = 3000;

/** Placeholder for an instant the server did not send. */
const NO_DATE = '—';

/** Locale namespace this plugin owns. */
const NS = 'settings.qwen';

/** English and Russian copy, keyed for the host locale dictionaries. */
const DICTS = {
  en: {
    nav: 'Qwen',
    title: 'Qwen (qwen.ai subscription)',
    endpoint: 'Provider qwen, endpoint: {endpoint}',
    endpointUnknown: 'unknown',
    loading: 'Loading…',
    noAccounts: 'No accounts yet.',
    signIn: 'Sign in',
    addAccount: 'Add account',
    poolHint: '{count} account(s) in the pool. When one runs out of quota, the request moves to the next.',
    confirmCode: 'Confirm the qwen.ai sign-in with this code:',
    codeUntil: 'The code is valid until {date}',
    codeLeft: '{left} left',
    codeExpired: 'code expired',
    openApproval: 'Open the approval page',
    cancel: 'Cancel',
    noEmail: 'account without email',
    preferred: 'default',
    tokenUntil: 'Access token until {date}',
    cooldownUntil: 'Paused until {date}',
    quotaUntil: 'Quota exhausted until {date}',
    quotaExhausted: 'Quota exhausted',
    makePreferred: 'Make default',
    signOut: 'Sign out',
    errNoRpc: 'No host connection: RPC is unavailable',
    errRpc: 'RPC call failed',
    errServer: 'The server returned an error',
    errUnknown: 'Unknown error',
    errNoFlowId: 'The server returned no sign-in id',
    errUnknownState: 'Unknown sign-in state: {state}',
    emptyState: 'empty',
    testConnection: 'Test connection',
    testOk: 'OK · {ms} ms · {models} models',
  },
  ru: {
    nav: 'Qwen',
    title: 'Qwen (подписка qwen.ai)',
    endpoint: 'Провайдер qwen, эндпоинт: {endpoint}',
    endpointUnknown: 'не известен',
    loading: 'Загрузка…',
    noAccounts: 'Аккаунтов пока нет.',
    signIn: 'Войти',
    addAccount: 'Добавить аккаунт',
    poolHint: 'Аккаунтов в пуле: {count}. Если квота исчерпана, запрос уходит на следующий аккаунт.',
    confirmCode: 'Подтвердите вход в qwen.ai этим кодом:',
    codeUntil: 'Код действует до {date}',
    codeLeft: 'осталось {left}',
    codeExpired: 'код истёк',
    openApproval: 'Открыть страницу подтверждения',
    cancel: 'Отмена',
    noEmail: 'аккаунт без email',
    preferred: 'по умолчанию',
    tokenUntil: 'Access-токен до {date}',
    cooldownUntil: 'Пауза до {date}',
    quotaUntil: 'Квота исчерпана до {date}',
    quotaExhausted: 'Квота исчерпана',
    makePreferred: 'Сделать основным',
    signOut: 'Выйти',
    errNoRpc: 'Нет соединения с хостом: RPC недоступен',
    errRpc: 'Сбой вызова RPC',
    errServer: 'Сервер вернул ошибку',
    errUnknown: 'Неизвестная ошибка',
    errNoFlowId: 'Сервер не вернул идентификатор входа',
    errUnknownState: 'Неизвестное состояние входа: {state}',
    emptyState: 'пусто',
    testConnection: 'Проверить соединение',
    testOk: 'ОК · {ms} мс · моделей: {models}',
  },
};

/** Interpolate {name} placeholders the way the host locale service does. */
function interpolate(template, params) {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match));
}

/**
 * Built-in translator used when the host locale service is absent (tests,
 * headless). It follows the browser language, defaulting to English.
 */
function fallbackTranslate() {
  const language = typeof navigator !== 'undefined' && /^ru/i.test(navigator.language || '') ? 'ru' : 'en';
  return (key, params) => {
    const dict = DICTS[language] || DICTS.en;
    const template = dict[key] !== undefined ? dict[key] : (DICTS.en[key] !== undefined ? DICTS.en[key] : key);
    return interpolate(template, params);
  };
}

/** Active translator; replaced by the host-bound one in apply(). */
let t = fallbackTranslate();
/** Compact layout for the narrow settings column; colours inherit the theme. */
const styles = {
  root: { display: 'flex', flexDirection: 'column', gap: 10, fontSize: 13, lineHeight: 1.45 },
  title: { margin: 0, fontSize: 14, fontWeight: 600 },
  hint: { margin: 0, opacity: 0.72 },
  card: { display: 'flex', flexDirection: 'column', gap: 6, padding: '10px 12px', borderRadius: 8, border: '1px solid rgba(127,127,127,0.28)', background: 'rgba(127,127,127,0.08)' },
  notice: { display: 'flex', flexDirection: 'column', gap: 6, padding: '10px 12px', borderRadius: 8, border: '1px solid rgba(127,127,127,0.32)', background: 'rgba(127,127,127,0.12)' },
  row: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  email: { fontWeight: 600, overflowWrap: 'anywhere' },
  badge: { padding: '1px 8px', borderRadius: 999, border: '1px solid rgba(127,127,127,0.4)', fontSize: 11, opacity: 0.85 },
  error: { padding: '8px 10px', borderRadius: 8, border: '1px solid rgba(220,38,38,0.45)', background: 'rgba(220,38,38,0.12)' },
  quota: { padding: '6px 8px', borderRadius: 6, border: '1px solid rgba(220,38,38,0.4)', background: 'rgba(220,38,38,0.12)', fontSize: 12 },
  button: { font: 'inherit', fontSize: 12, color: 'inherit', padding: '4px 10px', borderRadius: 6, border: '1px solid rgba(127,127,127,0.4)', background: 'rgba(127,127,127,0.14)', cursor: 'pointer' },
  primaryButton: { font: 'inherit', fontSize: 12, color: 'inherit', padding: '4px 10px', borderRadius: 6, border: '1px solid rgba(127,127,127,0.55)', background: 'rgba(127,127,127,0.26)', fontWeight: 600, cursor: 'pointer' },
  linkButton: { font: 'inherit', fontSize: 12, color: 'inherit', padding: '4px 10px', borderRadius: 6, border: '1px solid rgba(127,127,127,0.5)', background: 'rgba(127,127,127,0.18)', textDecoration: 'none' },
  disabledButton: { opacity: 0.5, cursor: 'default' },
  userCode: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 22, fontWeight: 700, letterSpacing: 3, overflowWrap: 'anywhere' },
};

/** Build one action button. */
function button(label, onClick, options) {
  const settings = options || {};
  const disabled = settings.disabled === true;
  const base = settings.primary ? styles.primaryButton : styles.button;
  const style = disabled ? Object.assign({}, base, styles.disabledButton) : base;
  return h('button', { type: 'button', style, disabled, onClick: disabled ? undefined : onClick }, label);
}

/** Format an ISO instant for the settings column. */
function formatInstant(value) {
  if (typeof value !== 'string' || value.length === 0) return NO_DATE;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return NO_DATE;
  const pad = (number) => (number < 10 ? '0' + number : String(number));
  return pad(date.getDate()) + '.' + pad(date.getMonth() + 1) + '.' + date.getFullYear() + ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes());
}

/** Remaining lifetime of one sign-in code, as a localized phrase. */
function countdownText(deadline, now) {
  if (!Number.isFinite(deadline)) return '';
  const left = deadline - now;
  if (!Number.isFinite(left)) return '';
  if (left <= 0) return t('codeExpired');
  const total = Math.floor(left / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  const clock = minutes + ':' + (seconds < 10 ? '0' + seconds : String(seconds));
  return t('codeLeft', { left: clock });
}

/** Normalise whatever a failed call threw into an Error. */
function toError(value) {
  if (value instanceof Error) return value;
  if (typeof value === 'string' && value.length > 0) return new Error(value);
  return new Error(t('errRpc'));
}

/** Human readable message of an error of unknown shape. */
function messageOf(error) {
  if (error && typeof error.message === 'string' && error.message.length > 0) return error.message;
  return t('errUnknown');
}

/** Call one host endpoint and unwrap its envelope. */
function callEndpoint(rpc, endpoint, payload) {
  if (!rpc || typeof rpc.call !== 'function') return Promise.reject(new Error(t('errNoRpc')));
  let pending;
  try {
    pending = rpc.call(CHANNEL, METHOD_PREFIX + endpoint, payload || {});
  } catch (error) {
    return Promise.reject(toError(error));
  }
  return Promise.resolve(pending).then(
    (result) => {
      if (result && result.ok === true) return result.value === undefined ? {} : result.value;
      const failure = result && result.error;
      const message = failure && typeof failure.message === 'string' && failure.message.length > 0 ? failure.message : t('errServer');
      const error = new Error(message);
      error.code = failure && typeof failure.code === 'string' ? failure.code : 'ERROR';
      throw error;
    },
    (error) => { throw toError(error); },
  );
}
/** Sign-in card for the open device flow. */
function renderFlow(flow, countdown, busy, onCancel) {
  return h('div', { style: styles.notice },
    h('div', { style: styles.hint }, t('confirmCode')),
    h('div', { style: styles.userCode }, flow.userCode ? flow.userCode : NO_DATE),
    flow.expiresAt
      ? h('div', { style: styles.hint }, t('codeUntil', { date: formatInstant(flow.expiresAt) }) + (countdown ? ' · ' + countdown : ''))
      : (countdown ? h('div', { style: styles.hint }, countdown) : null),
    flow.url
      ? h('div', { style: styles.row }, h('a', { href: flow.url, target: '_blank', rel: 'noreferrer noopener', style: styles.linkButton }, t('openApproval')))
      : null,
    h('div', { style: styles.row }, button(t('cancel'), onCancel, { disabled: busy })));
}

/** One account of the failover pool. */
function renderAccount(account, index, busy, onPrefer, onSignOut) {
  const source = account && typeof account === 'object' ? account : {};
  const id = typeof source.id === 'string' ? source.id : '';
  const label = typeof source.label === 'string' && source.label.length > 0 ? source.label : t('noEmail');
  const name = typeof source.name === 'string' ? source.name : '';
  const memberType = typeof source.memberType === 'string' ? source.memberType : '';
  const preferred = source.preferred === true;
  const expiresAt = typeof source.expiresAt === 'string' ? source.expiresAt : '';
  const cooldownUntil = typeof source.cooldownUntil === 'string' ? source.cooldownUntil : '';
  const quota = source.quota && typeof source.quota === 'object' ? source.quota : null;
  const quotaText = quota && quota.exhausted === true
    ? (typeof quota.resetAt === 'string' && quota.resetAt.length > 0 ? t('quotaUntil', { date: formatInstant(quota.resetAt) }) : t('quotaExhausted'))
    : '';
  return h('div', { key: id ? id : 'account-' + index, style: styles.card },
    h('div', { style: styles.row },
      h('span', { style: styles.email }, label),
      name ? h('span', { style: styles.hint }, name) : null,
      memberType ? h('span', { style: styles.badge }, memberType) : null,
      preferred ? h('span', { style: styles.badge }, t('preferred')) : null),
    h('div', { style: styles.hint }, t('tokenUntil', { date: formatInstant(expiresAt) })),
    cooldownUntil ? h('div', { style: styles.hint }, t('cooldownUntil', { date: formatInstant(cooldownUntil) })) : null,
    quotaText ? h('div', { style: styles.quota }, quotaText) : null,
    h('div', { style: styles.row },
      button(t('makePreferred'), () => onPrefer(id), { disabled: busy || preferred }),
      button(t('signOut'), () => onSignOut(id), { disabled: busy })));
}

/** Settings section of the Qwen subscription provider. */
function QwenSection(props) {
  const rpc = props && props.rpc ? props.rpc : null;
  const locale = props && props.locale ? props.locale : null;
  const [status, setStatus] = React.useState(null);
  const [pending, setPending] = React.useState(true);
  const [failure, setFailure] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [flow, setFlow] = React.useState(null);
  const [reloadKey, setReloadKey] = React.useState(0);
  const [now, setNow] = React.useState(() => Date.now());
  const [testInfo, setTestInfo] = React.useState(null);
  const [testing, setTesting] = React.useState(false);
  const [, forceLocale] = React.useState(0);
  const aliveRef = React.useRef(true);

  React.useEffect(() => () => { aliveRef.current = false; }, []);

  // Re-render when the host language changes, so every label follows it live.
  React.useEffect(() => {
    if (!locale || typeof locale.subscribe !== 'function') return undefined;
    return locale.subscribe(() => forceLocale((n) => n + 1));
  }, [locale]);

  React.useEffect(() => {
    let alive = true;
    setPending(true);
    callEndpoint(rpc, 'status', {})
      .then((value) => {
        if (!alive) return;
        setStatus(value && typeof value === 'object' ? value : {});
        setFailure('');
      })
      .catch((error) => { if (alive) setFailure(messageOf(error)); })
      .then(() => { if (alive) setPending(false); });
    return () => { alive = false; };
  }, [rpc, reloadKey]);

  const flowId = flow && typeof flow.flowId === 'string' ? flow.flowId : '';

  React.useEffect(() => {
    if (!flowId) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [flowId]);

  React.useEffect(() => {
    if (!flowId) return undefined;
    let stopped = false;
    const poll = () => {
      callEndpoint(rpc, 'loginPoll', { flowId })
        .then((value) => {
          if (stopped) return;
          const state = value && typeof value.state === 'string' ? value.state : '';
          if (state === 'pending') return;
          stopped = true;
          if (state === 'approved') {
            setFlow(null);
            setFailure('');
            setReloadKey((count) => count + 1);
            return;
          }
          setFlow(null);
          setFailure(t('errUnknownState', { state: state || t('emptyState') }));
        })
        .catch((error) => {
          if (stopped) return;
          stopped = true;
          setFlow(null);
          setFailure(messageOf(error));
        });
    };
    const timer = setInterval(poll, POLL_INTERVAL_MS);
    return () => { stopped = true; clearInterval(timer); };
  }, [flowId, rpc]);

  const runTest = () => {
    if (testing) return;
    setTesting(true);
    setTestInfo(null);
    callEndpoint(rpc, 'test', {})
      .then((value) => { if (aliveRef.current) setTestInfo({ ok: true, latencyMs: value.latencyMs, models: value.models }); })
      .catch((error) => { if (aliveRef.current) setTestInfo({ ok: false, message: messageOf(error) }); })
      .then(() => { if (aliveRef.current) setTesting(false); });
  };

  const startLogin = () => {
    if (busy) return;
    setBusy(true);
    setFailure('');
    callEndpoint(rpc, 'loginStart', {})
      .then((value) => {
        if (!aliveRef.current) return;
        const source = value && typeof value === 'object' ? value : {};
        const id = typeof source.flowId === 'string' ? source.flowId : '';
        if (!id) {
          setFlow(null);
          setFailure(t('errNoFlowId'));
          return;
        }
        setNow(Date.now());
        setFlow({
          flowId: id,
          userCode: typeof source.userCode === 'string' ? source.userCode : '',
          url: typeof source.url === 'string' ? source.url : '',
          expiresAt: typeof source.expiresAt === 'string' ? source.expiresAt : '',
        });
      })
      .catch((error) => { if (aliveRef.current) setFailure(messageOf(error)); })
      .then(() => { if (aliveRef.current) setBusy(false); });
  };

  const cancelLogin = () => {
    const id = flowId;
    setFlow(null);
    if (!id) return;
    callEndpoint(rpc, 'loginCancel', { flowId: id }).catch((error) => { if (aliveRef.current) setFailure(messageOf(error)); });
  };

  const makePreferred = (accountId) => {
    if (busy) return;
    setBusy(true);
    setFailure('');
    callEndpoint(rpc, 'prefer', { accountId })
      .then(() => { if (aliveRef.current) setReloadKey((count) => count + 1); })
      .catch((error) => { if (aliveRef.current) setFailure(messageOf(error)); })
      .then(() => { if (aliveRef.current) setBusy(false); });
  };

  const signOutAccount = (accountId) => {
    if (busy) return;
    setBusy(true);
    setFailure('');
    callEndpoint(rpc, 'signOut', { accountId })
      .then(() => { if (aliveRef.current) setReloadKey((count) => count + 1); })
      .catch((error) => { if (aliveRef.current) setFailure(messageOf(error)); })
      .then(() => { if (aliveRef.current) setBusy(false); });
  };

  const accounts = status && Array.isArray(status.accounts) ? status.accounts : [];
  const endpoint = status && typeof status.endpoint === 'string' ? status.endpoint : '';
  const loading = pending && !status;
  const countdown = flow && flow.expiresAt ? countdownText(Date.parse(flow.expiresAt), now) : '';
  const children = [
    h('div', { key: 'title', style: styles.title }, t('title')),
    h('p', { key: 'endpoint', style: styles.hint }, t('endpoint', { endpoint: endpoint || t('endpointUnknown') })),
    h('div', { key: 'test', style: styles.row },
      button(t('testConnection'), runTest, { disabled: testing }),
      testInfo
        ? h('span', { style: testInfo.ok ? styles.hint : styles.error },
            testInfo.ok ? t('testOk', { ms: testInfo.latencyMs, models: testInfo.models }) : testInfo.message)
        : null),
  ];

  if (failure) children.push(h('div', { key: 'failure', role: 'alert', style: styles.error }, failure));

  if (loading) {
    children.push(h('p', { key: 'loading', style: styles.hint }, t('loading')));
  } else if (!status) {
    // Nothing is known about the pool yet; the failure banner above says why.
  } else if (flow) {
    children.push(h('div', { key: 'flow' }, renderFlow(flow, countdown, busy, cancelLogin)));
  } else if (accounts.length === 0) {
    children.push(h('p', { key: 'empty', style: styles.hint }, t('noAccounts')));
    children.push(h('div', { key: 'login', style: styles.row }, button(t('signIn'), startLogin, { primary: true, disabled: busy })));
  } else {
    children.push(h('p', { key: 'pool', style: styles.hint }, t('poolHint', { count: accounts.length })));
    accounts.forEach((account, index) => {
      children.push(renderAccount(account, index, busy, makePreferred, signOutAccount));
    });
    children.push(h('div', { key: 'add', style: styles.row }, button(t('addAccount'), startLogin, { primary: true, disabled: busy })));
  }

  return h('div', { style: styles.root }, children);
}

/** Host services this client half needs. */
const inject = ['slots', 'connection'];

/** Register the Qwen card on the host settings ledger, with localized copy. */
function apply(ctx) {
  const connection = ctx.get('connection');
  const rpc = connection && connection.rpc ? connection.rpc : null;
  const locale = ctx.get('locale');
  if (locale && typeof locale.register === 'function' && typeof locale.bind === 'function') {
    ctx.effect(() => locale.register(NS, DICTS), 'dsh-llm-qwen-subscription: copy dictionaries');
    t = locale.bind(NS);
  }
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'qwen',
    order: 91,
    label: () => t('nav'),
    inject: () => ({ rpc, locale }),
  }, QwenSection));
}

exports.apply = apply;
exports.inject = inject;
return module.exports; } });
