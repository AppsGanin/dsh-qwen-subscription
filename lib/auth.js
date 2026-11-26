/**
 * Qwen subscription credentials: the account store transactions, per-account token
 * refresh, and the OAuth device-code flow every sign-in uses.
 *
 * The store is deliberately separate from any other client's credential file:
 * the provider rotates the refresh token, so two writers would invalidate each
 * other's sign-in.
 */
import {
  accountLabel, authFilePath, pickAccount, readState, transactState, upsertAccount,
} from './store.js'
import {
  AUTH_BASE_URL, AUTHORIZE_URL, CLIENT_ID, DEVICE_CODE_GRANT, OAUTH_SCOPE, REFRESH_MARGIN_MS,
} from './constants.js'
import { QwenFailure, signedOutFailure } from './errors.js'

export { authFilePath, readState }
/** Historical name of {@link readState}, kept for callers that only probe for a store. */
export const readAuthState = readState

/** Bound on one OAuth exchange, so a wedged endpoint cannot hang a request. */
const OAUTH_TIMEOUT_MS = 30000

/** Attach request-side failure codes to a transport rejection. */
function transportFailure(error, what) {
  const message = error instanceof Error ? error.message : String(error)
  return new QwenFailure('Qwen ' + what + ' failed: ' + message, { code: 'TRANSPORT', cause: error })
}

/** POST a form-encoded OAuth request and return the decoded JSON body. */
async function postOAuth(path, fields, signal) {
  const timeout = AbortSignal.timeout(OAUTH_TIMEOUT_MS)
  const effective = signal === undefined ? timeout : AbortSignal.any([signal, timeout])
  let response
  try {
    response = await fetch(AUTH_BASE_URL + '/api/oauth/' + path, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams(fields).toString(),
      signal: effective,
    })
  } catch (error) {
    if (signal !== undefined && signal.aborted) throw new QwenFailure('Qwen OAuth request aborted', { code: 'ABORTED', cause: error })
    throw transportFailure(error, 'OAuth')
  }
  const text = await response.text()
  let payload = undefined
  try {
    payload = JSON.parse(text)
  } catch (_nonJsonOAuthError) {
    payload = undefined
  }
  if (!response.ok) {
    const detail = payload !== null && typeof payload === 'object'
      ? [payload.error, payload.error_description].filter((part) => typeof part === 'string').join(': ')
      : text.slice(0, 200)
    throw new QwenFailure('Qwen OAuth ' + path + ' failed (HTTP ' + response.status + ')' + (detail.length > 0 ? ': ' + detail : ''), {
      code: 'AUTH',
      status: response.status,
    })
  }
  if (payload === undefined || typeof payload !== 'object') {
    throw new QwenFailure('Qwen OAuth ' + path + ' returned a non-JSON body', { code: 'AUTH', status: response.status })
  }
  return payload
}

/** Turn one token payload into a stored token record. */
export function tokensFromPayload(payload, previous) {
  const expiresIn = Number(payload.expires_in)
  const seconds = Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 900
  const refresh = typeof payload.refresh_token === 'string' && payload.refresh_token.length > 0
    ? payload.refresh_token
    : (previous !== undefined && typeof previous.refresh_token === 'string' ? previous.refresh_token : undefined)
  return {
    access_token: String(payload.access_token),
    refresh_token: refresh,
    token_type: typeof payload.token_type === 'string' ? payload.token_type : 'Bearer',
    scope: typeof payload.scope === 'string' ? payload.scope : (previous !== undefined && typeof previous.scope === 'string' ? previous.scope : OAUTH_SCOPE),
    expires_in: seconds,
    expires_at: Date.now() + seconds * 1000,
  }
}

/** Whether one token record is still usable beyond the refresh margin. */
export function tokenIsLive(tokens) {
  return tokens !== undefined && Number.isFinite(tokens.expires_at) && tokens.expires_at - Date.now() > REFRESH_MARGIN_MS
}

/**
 * Credential service for one plugin instance: per-account refresh (single-flight),
 * sign-in bookkeeping, sign-out, and preferred-account selection.
 */
export class QwenAuth {
  /** @param options - logger used for credential diagnostics. */
  constructor(options = {}) {
    this.logger = options.logger
    this.refreshing = new Map();
  }

  /** @returns the whole normalized store, or undefined when nothing is signed in. */
  async state() {
    return readState()
  }

  /** @returns every signed-in account. */
  async accounts() {
    const state = await readState()
    return state === undefined ? [] : state.accounts
  }

  /** @returns one account by id, else the preferred one, else the first. */
  async account(accountId) {
    const state = await readState()
    return pickAccount(state, accountId)
  }

  /**
   * Resolve one usable access token.
   * @param options - `accountId` selects an account, `force` refreshes a live token.
   * @returns the bearer token string.
   */
  async accessToken(options = {}) {
    const account = await this.account(options.accountId)
    if (account === undefined) throw signedOutFailure('no account is signed in')
    if (options.force !== true && tokenIsLive(account.tokens)) return account.tokens.access_token
    return this.refresh(account, options.signal)
  }

  /** Refresh one account's token, sharing one exchange between concurrent callers. */
  refresh(account, signal) {
    const existing = this.refreshing.get(account.id)
    if (existing !== undefined) return existing
    const run = this.refreshOnce(account, signal).finally(() => { this.refreshing.delete(account.id) })
    this.refreshing.set(account.id, run)
    return run
  }

  async refreshOnce(account, signal) {
    const refreshToken = account.tokens.refresh_token
    if (typeof refreshToken !== 'string' || refreshToken.length === 0) {
      throw signedOutFailure('the stored credentials of ' + accountLabel(account) + ' carry no refresh token')
    }
    let payload
    try {
      payload = await postOAuth('token', {
        grant_type: 'refresh_token',
        client_id: CLIENT_ID,
        refresh_token: refreshToken,
      }, signal)
    } catch (error) {
      if (error instanceof QwenFailure && error.code === 'AUTH') {
        throw new QwenFailure(
          'Qwen sign-in of ' + accountLabel(account) + ' is no longer valid; sign in again in Settings → Qwen. (' + error.message + ')',
          { code: 'AUTH', status: error.failure.status },
        )
      }
      throw error
    }
    const tokens = tokensFromPayload(payload, account.tokens)
    await transactState((state) => ({
      state: {
        ...state,
        accounts: state.accounts.map((entry) => entry.id === account.id
          ? { ...entry, tokens, updatedAt: new Date().toISOString() }
          : entry),
      },
      result: undefined,
    }))
    if (this.logger !== undefined) this.logger.debug('llm-qwen-subscription: refreshed the access token of ' + accountLabel(account))
    return tokens.access_token
  }

  /**
   * Store one completed sign-in.
   * @param input - the token payload, the provider user info, and an optional label.
   * @returns the stored account record.
   */
  async signIn(input) {
    const tokens = input.tokens ?? tokensFromPayload(input.payload);
    return transactState((state) => {
      const outcome = upsertAccount(state, { tokens, account: input.account, label: input.label })
      return { state: outcome.state, result: outcome.account }
    })
  }

  /** Revoke and forget one account, or every account when no id is named. */
  async signOut(accountId) {
    const state = await readState()
    if (state === undefined) return { signedOut: 0, revoked: false }
    const targets = typeof accountId === 'string' && accountId.length > 0
      ? state.accounts.filter((account) => account.id === accountId)
      : state.accounts
    if (targets.length === 0) return { signedOut: 0, revoked: false }
    let revoked = false
    for (const account of targets) {
      revoked = await revokeToken(account.tokens.refresh_token ?? account.tokens.access_token) || revoked
    }
    const ids = new Set(targets.map((account) => account.id))
    await transactState((current) => {
      const accounts = current.accounts.filter((account) => !ids.has(account.id))
      return {
        state: {
          ...current,
          accounts,
          preferredId: current.preferredId !== undefined && ids.has(current.preferredId)
            ? (accounts.length > 0 ? accounts[0].id : undefined)
            : current.preferredId,
        },
        result: undefined,
      }
    })
    return { signedOut: targets.length, revoked }
  }

  /** Mark one account preferred; the pool tries it first. */
  async setPreferred(accountId) {
    return transactState((state) => {
      if (!state.accounts.some((account) => account.id === accountId)) {
        throw new QwenFailure('unknown Qwen account ' + accountId, { code: 'BAD_REQUEST' })
      }
      return { state: { ...state, preferredId: accountId }, result: accountId }
    })
  }

  /** Forget a recorded quota refusal after the account served a request again. */
  async clearQuota(accountId) {
    return transactState((state) => {
      const account = state.accounts.find((entry) => entry.id === accountId);
      if (account === undefined || account.quota === undefined) return undefined;
      return {
        state: {
          ...state,
          accounts: state.accounts.map((entry) => entry.id === accountId ? { ...entry, quota: undefined } : entry),
        },
        result: undefined,
      };
    });
  }

  /** Remember one quota refusal so the settings page can show it after a restart. */
  async recordQuota(accountId, quota) {
    return transactState((state) => {
      if (!state.accounts.some((account) => account.id === accountId)) return undefined
      return {
        state: {
          ...state,
          accounts: state.accounts.map((account) => account.id === accountId ? { ...account, quota } : account),
        },
        result: undefined,
      }
    })
  }
}

/** Start one device authorization (RFC 8628) for this plugin's client registration. */
export async function requestDeviceCode(signal) {
  const payload = await postOAuth('device/code', { client_id: CLIENT_ID, scope: OAUTH_SCOPE }, signal)
  const expiresIn = Number(payload.expires_in)
  const interval = Number(payload.interval)
  const seconds = Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 900
  return {
    device_code: String(payload.device_code),
    user_code: String(payload.user_code),
    verification_uri: typeof payload.verification_uri === 'string' ? payload.verification_uri : AUTHORIZE_URL,
    interval_ms: Number.isFinite(interval) && interval > 0 ? interval * 1000 : 5000,
    expires_in: seconds,
    expires_at: Date.now() + seconds * 1000,
  }
}

/** Browser page that approves one device code. */
export function authorizeUrlFor(userCode) {
  const url = new URL(AUTHORIZE_URL)
  url.searchParams.set('user_code', userCode)
  url.searchParams.set('client', CLIENT_ID)
  url.searchParams.set('entry', 'qwen_code')
  return url.toString()
}

/**
 * Poll the token endpoint until the device is approved, refused, or expired.
 * @param device - the request from {@link requestDeviceCode}.
 * @param options - `signal` to cancel and `sleep` to override the wait (tests).
 * @returns the token payload.
 */
export async function pollDeviceToken(device, options = {}) {
  const sleep = options.sleep ?? ((ms, signal) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); resolve() }, ms)
    const onAbort = () => { cleanup(); reject(new QwenFailure('Qwen device-code polling aborted', { code: 'ABORTED' })) }
    function cleanup() {
      clearTimeout(timer)
      if (signal !== undefined) signal.removeEventListener('abort', onAbort)
    }
    if (signal !== undefined) {
      if (signal.aborted) {
        cleanup();
        reject(new QwenFailure('Qwen device-code polling aborted', { code: 'ABORTED' }));
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
    }
  }))
  const signal = options.signal
  let interval = device.interval_ms
  const deadline = device.expires_at
  while (true) {
    if (signal !== undefined && signal.aborted) throw new QwenFailure('Qwen device-code polling aborted', { code: 'ABORTED' })
    if (Date.now() >= deadline) throw new QwenFailure('The Qwen device code expired before it was approved; start again.', { code: 'AUTH' })
    await sleep(Math.min(interval, Math.max(0, deadline - Date.now())), signal)
    try {
      return await postOAuth('token', {
        grant_type: DEVICE_CODE_GRANT,
        client_id: CLIENT_ID,
        device_code: device.device_code,
      }, signal)
    } catch (error) {
      if (!(error instanceof QwenFailure) || error.failure.status !== 400) throw error
      const text = error.message
      if (text.includes('authorization_pending')) {
        interval = device.interval_ms;
        continue;
      }
      if (text.includes('slow_down')) {
        interval = device.interval_ms + 5000;
        continue;
      }
      throw error
    }
  }
}

/** Account facts the subscription token exposes, when the endpoint answers. */
export async function fetchUserInfo(accessToken, signal) {
  let response
  try {
    response = await fetch(AUTH_BASE_URL + '/api/oauth/userinfo', {
      headers: { authorization: 'Bearer ' + accessToken, accept: 'application/json' },
      signal: signal === undefined ? AbortSignal.timeout(OAUTH_TIMEOUT_MS) : AbortSignal.any([signal, AbortSignal.timeout(OAUTH_TIMEOUT_MS)]),
    })
  } catch (error) {
    return undefined
  }
  if (!response.ok) return undefined
  try {
    return await response.json()
  } catch (_nonJsonUserInfo) {
    return undefined
  }
}

/** Revoke one token at the provider; failures are not fatal for local sign-out. */
export async function revokeToken(token, kind = 'refresh_token', signal) {
  if (typeof token !== 'string' || token.length === 0) return false
  try {
    await postOAuth('revoke', { client_id: CLIENT_ID, token, token_type_hint: kind }, signal)
    return true
  } catch (_revocationFailure) {
    return false
  }
}
