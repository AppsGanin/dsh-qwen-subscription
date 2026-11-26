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
 * lists the accounts of the failover pool.
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

/** Compact layout for the narrow settings column; colours inherit the theme. */
const styles = {
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    fontSize: 13,
    lineHeight: 1.45,
  },
  title: { margin: 0, fontSize: 14, fontWeight: 600 },
  hint: { margin: 0, opacity: 0.72 },
  card: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    padding: '10px 12px',
    borderRadius: 8,
    border: '1px solid rgba(127,127,127,0.28)',
    background: 'rgba(127,127,127,0.08)',
  },
  notice: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    padding: '10px 12px',
    borderRadius: 8,
    border: '1px solid rgba(127,127,127,0.32)',
    background: 'rgba(127,127,127,0.12)',
  },
  row: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  email: { fontWeight: 600, overflowWrap: 'anywhere' },
  badge: {
    padding: '1px 8px',
    borderRadius: 999,
    border: '1px solid rgba(127,127,127,0.4)',
    fontSize: 11,
    opacity: 0.85,
  },
  error: {
    padding: '8px 10px',
    borderRadius: 8,
    border: '1px solid rgba(220,38,38,0.45)',
    background: 'rgba(220,38,38,0.12)',
  },
  quota: {
    padding: '6px 8px',
    borderRadius: 6,
    border: '1px solid rgba(220,38,38,0.4)',
    background: 'rgba(220,38,38,0.12)',
    fontSize: 12,
  },
  button: {
    font: 'inherit',
    fontSize: 12,
    color: 'inherit',
    padding: '4px 10px',
    borderRadius: 6,
    border: '1px solid rgba(127,127,127,0.4)',
    background: 'rgba(127,127,127,0.14)',
    cursor: 'pointer',
  },
  primaryButton: {
    font: 'inherit',
    fontSize: 12,
    color: 'inherit',
    padding: '4px 10px',
    borderRadius: 6,
    border: '1px solid rgba(127,127,127,0.55)',
    background: 'rgba(127,127,127,0.26)',
    fontWeight: 600,
    cursor: 'pointer',
  },
  linkButton: {
    font: 'inherit',
    fontSize: 12,
    color: 'inherit',
    padding: '4px 10px',
    borderRadius: 6,
    border: '1px solid rgba(127,127,127,0.5)',
    background: 'rgba(127,127,127,0.18)',
    textDecoration: 'none',
  },
  disabledButton: { opacity: 0.5, cursor: 'default' },
  userCode: {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: 22,
    fontWeight: 700,
    letterSpacing: 3,
    overflowWrap: 'anywhere',
  },
};

/**
 * Build one action button.
 * @param label - the visible Russian label.
 * @param onClick - click handler, ignored while the button is disabled.
 * @param options - optional flags: `primary` for the main action, `disabled`.
 * @returns the button element.
 */
function button(label, onClick, options) {
  const settings = options || {};
  const disabled = settings.disabled === true;
  const base = settings.primary ? styles.primaryButton : styles.button;
  const style = disabled ? Object.assign({}, base, styles.disabledButton) : base;
  return h('button', {
    type: 'button',
    style,
    disabled,
    onClick: disabled ? undefined : onClick,
  }, label);
}

/**
 * Format an ISO instant for the settings column.
 * @param value - ISO timestamp from the RPC contract, possibly missing.
 * @returns the local date and time, or a dash when the value is unusable.
 */
function formatInstant(value) {
  if (typeof value !== 'string' || value.length === 0) return NO_DATE;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return NO_DATE;
  const pad = (number) => (number < 10 ? '0' + number : String(number));
  return pad(date.getDate()) + '.' + pad(date.getMonth() + 1) + '.' + date.getFullYear()
    + ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes());
}

/**
 * Describe the remaining lifetime of one sign-in code.
 * @param deadline - millisecond timestamp of `expiresAt`, NaN when unknown.
 * @param now - the current millisecond timestamp from the render tick.
 * @returns a short Russian countdown, empty when the deadline is unusable.
 */
function formatCountdown(deadline, now) {
  if (!Number.isFinite(deadline)) return '';
  const left = deadline - now;
  if (!Number.isFinite(left)) return '';
  if (left <= 0) return 'код истёк';
  const total = Math.floor(left / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return 'осталось ' + minutes + ':' + (seconds < 10 ? '0' + seconds : String(seconds));
}

/**
 * Normalise whatever a failed call threw into an Error.
 * @param value - the rejection reason, an Error or any other value.
 * @returns an Error carrying a printable message.
 */
function toError(value) {
  if (value instanceof Error) return value;
  if (typeof value === 'string' && value.length > 0) return new Error(value);
  return new Error('Сбой вызова RPC');
}

/**
 * Human readable message of an error of unknown shape.
 * @param error - anything caught from a promise chain.
 * @returns the message, never empty.
 */
function messageOf(error) {
  if (error && typeof error.message === 'string' && error.message.length > 0) return error.message;
  return 'Неизвестная ошибка';
}

/**
 * Call one host endpoint of the plugin's channel and unwrap its envelope.
 * @param rpc - connection RPC caller injected into the slot, may be missing.
 * @param endpoint - endpoint name without the `qwen-auth.` method prefix.
 * @param payload - request payload, always an object.
 * @returns a promise of the `value` of the `{ ok: true }` answer; a failed
 * answer rejects with an Error carrying `error.message`.
 */
function callEndpoint(rpc, endpoint, payload) {
  if (!rpc || typeof rpc.call !== 'function') {
    return Promise.reject(new Error('Нет соединения с хостом: RPC недоступен'));
  }
  let pending;
  try {
    pending = rpc.call(CHANNEL, METHOD_PREFIX + endpoint, payload || {});
  } catch (error) {
    return Promise.reject(toError(error));
  }
  return Promise.resolve(pending).then(
    (result) => {
      if (result && result.ok === true) {
        return result.value === undefined ? {} : result.value;
      }
      const failure = result && result.error;
      const message = failure && typeof failure.message === 'string' && failure.message.length > 0
        ? failure.message
        : 'Сервер вернул ошибку';
      const error = new Error(message);
      error.code = failure && typeof failure.code === 'string' ? failure.code : 'ERROR';
      throw error;
    },
    (error) => {
      throw toError(error);
    },
  );
}

/**
 * Sign-in card for the open device flow: the code, the confirmation link, the
 * countdown to `expiresAt`, and the cancel action.
 * @param flow - the `loginStart` value kept in component state.
 * @param countdown - pre-formatted remaining lifetime.
 * @param busy - whether another request is in flight.
 * @param onCancel - cancels the flow through `loginCancel`.
 * @returns the card element.
 */
function renderFlow(flow, countdown, busy, onCancel) {
  return h('div', { style: styles.notice },
    h('div', { style: styles.hint }, 'Подтвердите вход в qwen.ai этим кодом:'),
    h('div', { style: styles.userCode }, flow.userCode ? flow.userCode : NO_DATE),
    flow.expiresAt
      ? h('div', { style: styles.hint },
        'Код действует до ' + formatInstant(flow.expiresAt) + (countdown ? ' · ' + countdown : ''))
      : (countdown ? h('div', { style: styles.hint }, countdown) : null),
    flow.url
      ? h('div', { style: styles.row },
        h('a', {
          href: flow.url,
          target: '_blank',
          rel: 'noreferrer noopener',
          style: styles.linkButton,
        }, 'Открыть страницу подтверждения'))
      : null,
    h('div', { style: styles.row }, button('Отмена', onCancel, { disabled: busy })));
}

/**
 * One account of the failover pool.
 * @param account - the entry from `status.accounts`, possibly incomplete.
 * @param index - position in the list, used as a render key fallback.
 * @param busy - whether another request is in flight.
 * @param onPrefer - marks this account preferred through `prefer`.
 * @param onSignOut - signs this account out through `signOut`.
 * @returns the account card element.
 */
function renderAccount(account, index, busy, onPrefer, onSignOut) {
  const source = account && typeof account === 'object' ? account : {};
  const id = typeof source.id === 'string' ? source.id : '';
  const label = typeof source.label === 'string' && source.label.length > 0
    ? source.label
    : 'аккаунт без email';
  const name = typeof source.name === 'string' ? source.name : '';
  const memberType = typeof source.memberType === 'string' ? source.memberType : '';
  const preferred = source.preferred === true;
  const expiresAt = typeof source.expiresAt === 'string' ? source.expiresAt : '';
  const cooldownUntil = typeof source.cooldownUntil === 'string' ? source.cooldownUntil : '';
  const quota = source.quota && typeof source.quota === 'object' ? source.quota : null;
  const quotaText = quota && quota.exhausted === true
    ? (typeof quota.resetAt === 'string' && quota.resetAt.length > 0
      ? 'Квота исчерпана до ' + formatInstant(quota.resetAt)
      : 'Квота исчерпана')
    : '';
  return h('div', { key: id ? id : 'account-' + index, style: styles.card },
    h('div', { style: styles.row },
      h('span', { style: styles.email }, label),
      name ? h('span', { style: styles.hint }, name) : null,
      memberType ? h('span', { style: styles.badge }, memberType) : null,
      preferred ? h('span', { style: styles.badge }, 'по умолчанию') : null),
    h('div', { style: styles.hint }, 'Access-токен до ' + formatInstant(expiresAt)),
    cooldownUntil ? h('div', { style: styles.hint }, 'Пауза до ' + formatInstant(cooldownUntil)) : null,
    quotaText ? h('div', { style: styles.quota }, quotaText) : null,
    h('div', { style: styles.row },
      button('Сделать основным', () => onPrefer(id), { disabled: busy || preferred }),
      button('Выйти', () => onSignOut(id), { disabled: busy })));
}

/**
 * Settings section of the Qwen subscription provider.
 * @param props - slot props; `rpc` is the host connection's RPC caller.
 * @returns the rendered section.
 */
function QwenSection(props) {
  const rpc = props && props.rpc ? props.rpc : null;
  const [status, setStatus] = React.useState(null);
  const [pending, setPending] = React.useState(true);
  const [failure, setFailure] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [flow, setFlow] = React.useState(null);
  const [reloadKey, setReloadKey] = React.useState(0);
  const [now, setNow] = React.useState(() => Date.now());
  const aliveRef = React.useRef(true);

  React.useEffect(() => () => {
    aliveRef.current = false;
  }, []);

  // Status: loaded on mount and refreshed after every successful sign in, sign
  // out, or preference change.
  React.useEffect(() => {
    let alive = true;
    setPending(true);
    callEndpoint(rpc, 'status', {})
      .then((value) => {
        if (!alive) return;
        setStatus(value && typeof value === 'object' ? value : {});
        setFailure('');
      })
      .catch((error) => {
        if (!alive) return;
        setFailure(messageOf(error));
      })
      .then(() => {
        if (alive) setPending(false);
      });
    return () => {
      alive = false;
    };
  }, [rpc, reloadKey]);

  const flowId = flow && typeof flow.flowId === 'string' ? flow.flowId : '';

  // Countdown for an open flow; the interval only exists while a flow is open.
  React.useEffect(() => {
    if (!flowId) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [flowId]);

  // Progress of the open flow: the Node half polls the provider, the page polls
  // the Node half every POLL_INTERVAL_MS until it is approved or refused.
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
          setFailure('Неизвестное состояние входа: ' + (state || 'пусто'));
        })
        .catch((error) => {
          if (stopped) return;
          stopped = true;
          setFlow(null);
          setFailure(messageOf(error));
        });
    };
    const timer = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [flowId, rpc]);

  /** Open a device flow; the same action adds a second account to the pool. */
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
          setFailure('Сервер не вернул идентификатор входа');
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
      .catch((error) => {
        if (aliveRef.current) setFailure(messageOf(error));
      })
      .then(() => {
        if (aliveRef.current) setBusy(false);
      });
  };

  /** Drop the open flow locally and tell the host to forget it. */
  const cancelLogin = () => {
    const id = flowId;
    setFlow(null);
    if (!id) return;
    callEndpoint(rpc, 'loginCancel', { flowId: id }).catch((error) => {
      if (aliveRef.current) setFailure(messageOf(error));
    });
  };

  /** Mark one account as the preferred route of the pool. */
  const makePreferred = (accountId) => {
    if (busy) return;
    setBusy(true);
    setFailure('');
    callEndpoint(rpc, 'prefer', { accountId })
      .then(() => {
        if (aliveRef.current) setReloadKey((count) => count + 1);
      })
      .catch((error) => {
        if (aliveRef.current) setFailure(messageOf(error));
      })
      .then(() => {
        if (aliveRef.current) setBusy(false);
      });
  };

  /** Sign one account out and refresh the pool afterwards. */
  const signOutAccount = (accountId) => {
    if (busy) return;
    setBusy(true);
    setFailure('');
    callEndpoint(rpc, 'signOut', { accountId })
      .then(() => {
        if (aliveRef.current) setReloadKey((count) => count + 1);
      })
      .catch((error) => {
        if (aliveRef.current) setFailure(messageOf(error));
      })
      .then(() => {
        if (aliveRef.current) setBusy(false);
      });
  };

  const accounts = status && Array.isArray(status.accounts) ? status.accounts : [];
  const endpoint = status && typeof status.endpoint === 'string' ? status.endpoint : '';
  const loading = pending && !status;
  const countdown = flow && flow.expiresAt
    ? formatCountdown(Date.parse(flow.expiresAt), now)
    : '';
  const children = [
    h('div', { key: 'title', style: styles.title }, 'Qwen (подписка qwen.ai)'),
    h('p', { key: 'endpoint', style: styles.hint },
      'Провайдер qwen, эндпоинт: ' + (endpoint || 'не известен')),
  ];

  if (failure) {
    children.push(h('div', { key: 'failure', role: 'alert', style: styles.error }, failure));
  }

  if (loading) {
    children.push(h('p', { key: 'loading', style: styles.hint }, 'Загрузка…'));
  } else if (!status) {
    // Nothing is known about the pool yet; the failure banner above says why.
  } else if (flow) {
    children.push(h('div', { key: 'flow' }, renderFlow(flow, countdown, busy, cancelLogin)));
  } else if (accounts.length === 0) {
    children.push(h('p', { key: 'empty', style: styles.hint }, 'Аккаунтов пока нет.'));
    children.push(h('div', { key: 'login', style: styles.row },
      button('Войти', startLogin, { primary: true, disabled: busy })));
  } else {
    children.push(h('p', { key: 'pool', style: styles.hint },
      'Аккаунтов в пуле: ' + accounts.length
      + '. Если квота исчерпана, запрос уходит на следующий аккаунт.'));
    accounts.forEach((account, index) => {
      children.push(renderAccount(account, index, busy, makePreferred, signOutAccount));
    });
    children.push(h('div', { key: 'add', style: styles.row },
      button('Добавить аккаунт', startLogin, { primary: true, disabled: busy })));
  }

  return h('div', { style: styles.root }, children);
}

/** Host services this client half needs. */
const inject = ['slots', 'connection'];

/**
 * Register the Qwen card on the host's settings ledger.
 * @param ctx - client root context carrying the slots and connection services.
 */
function apply(ctx) {
  const connection = ctx.get('connection');
  const rpc = connection && connection.rpc ? connection.rpc : null;
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'qwen',
    order: 91,
    label: () => 'Qwen',
    inject: () => ({ rpc }),
  }, QwenSection));
}

exports.apply = apply;
exports.inject = inject;
return module.exports; } });
