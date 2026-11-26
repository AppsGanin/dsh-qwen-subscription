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
    modelsLabel: 'Models',
    poolLabel: 'Accounts',
    modelUsage: '{model}: {requests} requests · {input} in / {output} out tokens',
    signOutAll: 'Sign out all',
    usageLine: '{requests} requests · {input} in / {output} out tokens',
    labelPlaceholder: 'Optional account note',
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
    modelsLabel: 'Модели',
    poolLabel: 'Аккаунты',
    modelUsage: '{model}: запросов {requests} · {input} вх. / {output} исх.',
    signOutAll: 'Выйти из всех',
    usageLine: 'запросов: {requests} · токенов: {input} вх. / {output} исх.',
    labelPlaceholder: 'Необязательная заметка об аккаунте',
  },
  zh: {
    nav: 'Qwen',
    title: 'Qwen（qwen.ai 订阅）',
    endpoint: '提供商 qwen，端点：{endpoint}',
    endpointUnknown: '未知',
    loading: '加载中…',
    noAccounts: '还没有账号。',
    signIn: '登录',
    addAccount: '添加账号',
    poolHint: '池中有 {count} 个账号。某个账号额度用尽时，请求会转到下一个。',
    confirmCode: '用此代码确认 qwen.ai 登录：',
    codeUntil: '代码有效期至 {date}',
    codeLeft: '剩余 {left}',
    codeExpired: '代码已过期',
    openApproval: '打开确认页面',
    cancel: '取消',
    noEmail: '无邮箱账号',
    preferred: '默认',
    tokenUntil: '访问令牌至 {date}',
    cooldownUntil: '暂停至 {date}',
    quotaUntil: '额度已用尽，至 {date}',
    quotaExhausted: '额度已用尽',
    makePreferred: '设为默认',
    signOut: '退出',
    errNoRpc: '未连接主机：RPC 不可用',
    errRpc: 'RPC 调用失败',
    errServer: '服务器返回错误',
    errUnknown: '未知错误',
    errNoFlowId: '服务器未返回登录标识',
    errUnknownState: '未知登录状态：{state}',
    emptyState: '空',
    testConnection: '测试连接',
    testOk: '正常 · {ms} 毫秒 · {models} 个模型',
    modelsLabel: '模型',
    poolLabel: '账号',
    modelUsage: '{model}：{requests} 次请求 · 输入 {input} / 输出 {output} 令牌',
    signOutAll: '退出所有',
    usageLine: '{requests} 次请求 · 输入 {input} / 输出 {output} 令牌',
    labelPlaceholder: '可选的账号备注',
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
  root: { display: 'flex', flexDirection: 'column', gap: 12, fontSize: 13, lineHeight: 1.5 },
  header: { display: 'flex', alignItems: 'center', gap: 10 },
  avatar: { width: 34, height: 34, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 16, color: '#fff', background: 'linear-gradient(135deg, #7c5cff, #4f8bff)', flex: '0 0 auto' },
  headerText: { display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0, flex: '1 1 auto' },
  title: { margin: 0, fontSize: 14, fontWeight: 600, overflowWrap: 'anywhere' },
  section: { display: 'flex', flexDirection: 'column', gap: 6 },
  sectionLabel: { margin: 0, fontSize: 11, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', opacity: 0.55 },
  chips: { display: 'flex', flexWrap: 'wrap', gap: 6 },
  chip: { padding: '2px 8px', borderRadius: 999, border: '1px solid rgba(127,127,127,0.32)', background: 'rgba(127,127,127,0.08)', fontSize: 11, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' },
  card: { display: 'flex', flexDirection: 'column', gap: 8, padding: '12px 14px', borderRadius: 12, border: '1px solid rgba(127,127,127,0.24)', background: 'rgba(127,127,127,0.06)' },
  cardPreferred: { borderColor: 'rgba(124,92,255,0.55)', boxShadow: '0 0 0 1px rgba(124,92,255,0.18) inset' },
  notice: { display: 'flex', flexDirection: 'column', gap: 8, padding: '12px 14px', borderRadius: 12, border: '1px solid rgba(124,92,255,0.4)', background: 'rgba(124,92,255,0.08)' },
  row: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  rowBetween: { display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between', flexWrap: 'wrap' },
  email: { fontWeight: 600, overflowWrap: 'anywhere' },
  name: { fontSize: 12, opacity: 0.72, overflowWrap: 'anywhere' },
  badge: { padding: '1px 8px', borderRadius: 999, border: '1px solid rgba(127,127,127,0.35)', fontSize: 11, opacity: 0.85 },
  badgeAccent: { padding: '1px 8px', borderRadius: 999, border: '1px solid rgba(124,92,255,0.5)', background: 'rgba(124,92,255,0.14)', fontSize: 11, fontWeight: 600 },
  hint: { margin: 0, fontSize: 12, opacity: 0.68 },
  usage: { display: 'flex', flexDirection: 'column', gap: 2, padding: '8px 10px', borderRadius: 8, background: 'rgba(127,127,127,0.08)', fontSize: 12 },
  error: { padding: '8px 10px', borderRadius: 8, border: '1px solid rgba(220,38,38,0.45)', background: 'rgba(220,38,38,0.12)' },
  quota: { padding: '6px 10px', borderRadius: 8, border: '1px solid rgba(220,38,38,0.4)', background: 'rgba(220,38,38,0.12)', fontSize: 12 },
  button: { font: 'inherit', fontSize: 12, color: 'inherit', padding: '5px 11px', borderRadius: 8, border: '1px solid rgba(127,127,127,0.36)', background: 'transparent', cursor: 'pointer' },
  primaryButton: { font: 'inherit', fontSize: 12, color: '#fff', padding: '5px 12px', borderRadius: 8, border: '1px solid transparent', background: 'linear-gradient(135deg, #7c5cff, #4f8bff)', fontWeight: 600, cursor: 'pointer' },
  dangerButton: { font: 'inherit', fontSize: 12, color: 'inherit', padding: '5px 11px', borderRadius: 8, border: '1px solid rgba(220,38,38,0.45)', background: 'transparent', cursor: 'pointer' },
  linkButton: { font: 'inherit', fontSize: 12, color: 'inherit', padding: '5px 11px', borderRadius: 8, border: '1px solid rgba(124,92,255,0.5)', background: 'rgba(124,92,255,0.1)', textDecoration: 'none', display: 'inline-block' },
  disabledButton: { opacity: 0.5, cursor: 'default' },
  input: { font: 'inherit', fontSize: 12, color: 'inherit', padding: '6px 9px', borderRadius: 8, border: '1px solid rgba(127,127,127,0.36)', background: 'transparent', flex: '1 1 160px', minWidth: 0 },
  userCode: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 26, fontWeight: 700, letterSpacing: 4, overflowWrap: 'anywhere' },
};

/** Build one action button; `variant` selects primary, danger or the neutral look. */
function button(label, onClick, options) {
  const settings = options || {};
  const disabled = settings.disabled === true;
  const variant = settings.variant === 'primary' || settings.primary === true
    ? styles.primaryButton
    : settings.variant === 'danger'
      ? styles.dangerButton
      : styles.button;
  const style = disabled ? Object.assign({}, variant, styles.disabledButton) : variant;
  return h('button', { type: 'button', style, disabled, 'aria-label': label, onClick: disabled ? undefined : onClick }, label);
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
  const meta = flow.expiresAt
    ? t('codeUntil', { date: formatInstant(flow.expiresAt) }) + (countdown ? ' · ' + countdown : '')
    : countdown;
  return h('div', { style: styles.notice },
    h('p', { style: styles.sectionLabel }, t('confirmCode')),
    h('div', { style: styles.userCode }, flow.userCode ? flow.userCode : NO_DATE),
    meta ? h('div', { style: styles.hint }, meta) : null,
    h('div', { style: styles.row },
      flow.url ? h('a', { href: flow.url, target: '_blank', rel: 'noreferrer noopener', style: styles.linkButton }, t('openApproval')) : null,
      button(t('cancel'), onCancel, { disabled: busy })));
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
  const usage = source.usage !== null && typeof source.usage === 'object' ? source.usage : null;
  const perModel = usage !== null && usage.models !== null && typeof usage.models === 'object' ? Object.entries(usage.models) : [];
  return h('div', { key: id ? id : 'account-' + index, style: preferred ? Object.assign({}, styles.card, styles.cardPreferred) : styles.card },
    h('div', { style: styles.rowBetween },
      h('div', { style: styles.row },
        h('span', { style: styles.email }, label),
        name ? h('span', { style: styles.name }, name) : null),
      h('div', { style: styles.row },
        memberType ? h('span', { style: styles.badge }, memberType) : null,
        preferred ? h('span', { style: styles.badgeAccent }, t('preferred')) : null)),
    h('div', { style: styles.hint }, t('tokenUntil', { date: formatInstant(expiresAt) })),
    cooldownUntil ? h('div', { style: styles.hint }, t('cooldownUntil', { date: formatInstant(cooldownUntil) })) : null,
    quotaText ? h('div', { style: styles.quota }, quotaText) : null,
    usage !== null
      ? h('div', { style: styles.usage },
          h('div', null, t('usageLine', { requests: usage.requests, input: usage.inputTokens, output: usage.outputTokens })),
          perModel.map(([model, counters]) => h('div', { key: 'model-' + model, style: styles.hint },
            t('modelUsage', { model, requests: counters.requests, input: counters.inputTokens, output: counters.outputTokens }))))
      : null,
    h('div', { style: styles.row },
      button(t('makePreferred'), () => onPrefer(id), { variant: 'primary', disabled: busy || preferred }),
      button(t('signOut'), () => onSignOut(id), { variant: 'danger', disabled: busy })));
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
  const [labelNote, setLabelNote] = React.useState('');
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
    callEndpoint(rpc, 'loginStart', { label: labelNote })
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

  const signOutEveryAccount = () => {
    if (busy) return;
    setBusy(true);
    setFailure('');
    callEndpoint(rpc, 'signOut', {})
      .then(() => { if (aliveRef.current) setReloadKey((count) => count + 1); })
      .catch((error) => { if (aliveRef.current) setFailure(messageOf(error)); })
      .then(() => { if (aliveRef.current) setBusy(false); });
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
    h('div', { key: 'header', style: styles.header },
      h('span', { style: styles.avatar, 'aria-hidden': 'true' }, 'Q'),
      h('div', { style: styles.headerText },
        h('h3', { style: styles.title }, t('title')),
        h('p', { style: styles.hint }, t('endpoint', { endpoint: endpoint || t('endpointUnknown') })))),
    h('div', { key: 'test', style: styles.row },
      button(t('testConnection'), runTest, { disabled: testing }),
      testInfo
        ? h('span', { style: testInfo.ok ? styles.hint : styles.error },
            testInfo.ok ? t('testOk', { ms: testInfo.latencyMs, models: testInfo.models }) : testInfo.message)
        : null),
  ];

  if (status && Array.isArray(status.models) && status.models.length > 0) {
    children.push(h('div', { key: 'models', style: styles.section },
      h('p', { style: styles.sectionLabel }, t('modelsLabel')),
      h('div', { style: styles.chips },
        status.models.map((model) => h('span', { key: 'model-' + model.id, style: styles.chip, title: model.id }, model.id)))));
  }

  if (failure) children.push(h('div', { key: 'failure', role: 'alert', style: styles.error }, failure));

  if (loading) {
    children.push(h('p', { key: 'loading', style: styles.hint }, t('loading')));
  } else if (!status) {
    // Nothing is known about the pool yet; the failure banner above says why.
  } else if (flow) {
    children.push(h('div', { key: 'flow' }, renderFlow(flow, countdown, busy, cancelLogin)));
  } else if (accounts.length === 0) {
    children.push(h('p', { key: 'empty', style: styles.hint }, t('noAccounts')));
    children.push(h('div', { key: 'label', style: styles.row },
      h('input', { type: 'text', style: styles.input, placeholder: t('labelPlaceholder'), 'aria-label': t('labelPlaceholder'), value: labelNote, onChange: (e) => setLabelNote(e.target.value) })));
    children.push(h('div', { key: 'login', style: styles.row }, button(t('signIn'), startLogin, { primary: true, disabled: busy })));
  } else {
    children.push(h('div', { key: 'pool', style: styles.section },
      h('p', { style: styles.sectionLabel }, t('poolLabel')),
      h('p', { style: styles.hint }, t('poolHint', { count: accounts.length })),
      accounts.map((account, index) => renderAccount(account, index, busy, makePreferred, signOutAccount))));
    children.push(h('div', { key: 'label', style: styles.row },
      h('input', { type: 'text', style: styles.input, placeholder: t('labelPlaceholder'), 'aria-label': t('labelPlaceholder'), value: labelNote, onChange: (e) => setLabelNote(e.target.value) })));
    children.push(h('div', { key: 'add', style: styles.row },
      button(t('addAccount'), startLogin, { primary: true, disabled: busy }),
      button(t('signOutAll'), signOutEveryAccount, { disabled: busy })));
  }

  return h('div', { style: styles.root, 'data-qwen-card': '' }, children);
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
  // Hover feedback and visible keyboard focus for the card's controls. Inline
  // styles cannot express :hover or :focus-visible, so a scoped stylesheet is
  // injected and removed on dispose.
  if (typeof document !== 'undefined') {
    ctx.effect(() => {
      const style = document.createElement('style');
      style.setAttribute('data-plugin', 'dsh-llm-qwen-subscription');
      style.textContent = [
        '[data-qwen-card] button:focus-visible, [data-qwen-card] input:focus-visible, [data-qwen-card] a:focus-visible { outline: 2px solid currentColor; outline-offset: 2px; }',
        '[data-qwen-card] button, [data-qwen-card] a { transition: filter 120ms ease, border-color 120ms ease; }',
        '[data-qwen-card] button:not(:disabled):hover, [data-qwen-card] a:hover { filter: brightness(1.12); }',
        '[data-qwen-card] button:not(:disabled):active { filter: brightness(0.96); }',
        '[data-qwen-card] input:focus-visible { border-color: rgba(124,92,255,0.7); }',
        '@media (prefers-reduced-motion: reduce) { [data-qwen-card] button, [data-qwen-card] a { transition: none; } }',
      ].join('\n');
      document.head.appendChild(style);
      return () => style.remove();
    }, 'dsh-llm-qwen-subscription: hover and focus styles');
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
