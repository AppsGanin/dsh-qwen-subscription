/**
 * Settings RPC: the `/qwen-auth` channel the browser settings page drives.
 *
 * The Node half owns the device-code flows, so the page only starts one, polls its
 * state, and cancels it. Every handler answers the connection result shape and
 * never rejects, because a rejection becomes an opaque transport failure in the UI.
 */
import { randomUUID } from 'node:crypto'
import {
  authorizeUrlFor, fetchUserInfo, pollDeviceToken, requestDeviceCode, tokensFromPayload,
} from './auth.js'
import { QwenFailure } from './errors.js'
import { accountLabel, authFilePath } from './store.js'

/** Absolute RPC channel this plugin owns. */
export const AUTH_CHANNEL = '/qwen-auth'

/** Endpoints the channel answers. */
export const AUTH_ENDPOINTS = ['status', 'loginStart', 'loginPoll', 'loginCancel', 'signOut', 'prefer']

/** A flow whose approval was never observed stops occupying memory after this. */
const FLOW_TTL_MS = 20 * 60000

/** Success result of one endpoint. */
function ok(value) {
  return { ok: true, value }
}

/** Business failure result of one endpoint. */
function failure(error) {
  const message = error instanceof Error ? error.message : String(error)
  const code = error instanceof QwenFailure ? error.code : 'INTERNAL'
  return { ok: false, error: { code, message } }
}

/** Read one string field of an RPC payload, when present. */
function field(payload, name) {
  if (payload === null || typeof payload !== 'object') return undefined
  const value = payload[name]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/**
 * Owns the settings-facing operations of one plugin instance: status, device-code
 * sign-in flows, sign-out, and preferred-account selection.
 */
export class AuthController {
  /**
   * @param options - credential service, account pool, adapter (for the model list),
   *   registered provider route, logger, and a sign-in notification hook.
   */
  constructor(options) {
    this.auth = options.auth
    this.pool = options.pool
    this.adapter = options.adapter
    this.provider = options.provider
    this.logger = options.logger
    this.onSignedIn = options.onSignedIn
    this.flows = new Map()
  }

  /**
   * Answer one RPC endpoint.
   * @param endpoint - endpoint name from {@link AUTH_ENDPOINTS}.
   * @param payload - endpoint-owned request payload.
   * @param signal - cancellation of the browser request.
   * @returns the connection result shape.
   */
  async dispatch(endpoint, payload, signal) {
    try {
      switch (endpoint) {
        case 'status': return ok(await this.status());
        case 'loginStart': return ok(await this.loginStart(payload, signal));
        case 'loginPoll': return await this.loginPoll(field(payload, 'flowId'));
        case 'loginCancel': return ok(this.loginCancel(field(payload, 'flowId')));
        case 'signOut': return ok(await this.auth.signOut(field(payload, 'accountId')));
        case 'prefer': {
          const accountId = field(payload, 'accountId');
          if (accountId === undefined) throw new QwenFailure('prefer needs an accountId', { code: 'BAD_REQUEST' });
          await this.auth.setPreferred(accountId);
          return ok({ ok: true });
        }
        default: throw new QwenFailure('unknown /qwen-auth endpoint ' + String(endpoint), { code: 'BAD_REQUEST' });
      }
    } catch (error) {
      return failure(error);
    }
  }

  /** Snapshot the page renders: accounts, cooldowns, quota, and advertised models. */
  async status() {
    const state = await this.auth.state()
    let models = [];
    try {
      models = await this.adapter.listModels(this.provider)
    } catch (_catalogUnavailable) {
      models = [];
    }
    const accounts = state === undefined ? [] : state.accounts.map((account) => {
      const cooldown = this.pool.cooldownOf(account.id)
      const quota = account.quota !== null && typeof account.quota === 'object'
        ? {
          exhausted: account.quota.exhausted === true,
          observedAt: typeof account.quota.observedAt === 'string' ? account.quota.observedAt : null,
          resetAt: typeof account.quota.resetAt === 'string' ? account.quota.resetAt : null,
          message: typeof account.quota.message === 'string' ? account.quota.message : null,
        }
        : null;
      return {
        id: account.id,
        label: accountLabel(account),
        name: typeof account.name === 'string' ? account.name : null,
        memberType: typeof account.memberType === 'string' ? account.memberType : null,
        expiresAt: Number.isFinite(account.tokens.expires_at) ? new Date(account.tokens.expires_at).toISOString() : null,
        preferred: state !== undefined && state.preferredId === account.id,
        cooldownUntil: cooldown === undefined ? null : cooldown.until,
        quota,
      };
    });
    return {
      provider: this.provider,
      signedIn: accounts.length > 0,
      authFile: authFilePath(),
      endpoint: typeof this.adapter.apiBase === 'string' ? this.adapter.apiBase : null,
      accounts,
      models: models.map((model) => ({ id: model.id, name: model.name })),
    };
  }

  /** Start one device flow; the poller runs here so the page only has to ask. */
  async loginStart(payload, signal) {
    this.pruneFlows()
    const device = await requestDeviceCode(signal)
    const flowId = 'flow_' + randomUUID().slice(0, 8)
    const abort = new AbortController()
    const flow = {
      flowId,
      device,
      state: 'pending',
      abort,
      label: field(payload, 'label'),
      createdAt: Date.now(),
      expiresAt: device.expires_at,
    }
    this.flows.set(flowId, flow)
    void this.pollFlow(flow)
    return {
      flowId,
      userCode: device.user_code,
      url: authorizeUrlFor(device.user_code),
      expiresAt: new Date(device.expires_at).toISOString(),
    }
  }

  /** Background approval watcher of one flow. */
  async pollFlow(flow) {
    try {
      const payload = await pollDeviceToken(flow.device, { signal: flow.abort.signal });
      const tokens = tokensFromPayload(payload);
      const account = await fetchUserInfo(tokens.access_token, flow.abort.signal);
      const stored = await this.auth.signIn({ tokens, account, label: flow.label });
      flow.state = 'approved';
      flow.account = { id: stored.id, label: accountLabel(stored) };
      if (this.logger !== undefined) this.logger.info('llm-qwen-subscription: signed in ' + flow.account.label);
      if (this.onSignedIn !== undefined) this.onSignedIn(stored);
    } catch (error) {
      flow.state = 'failed';
      flow.error = error instanceof Error ? error : new QwenFailure(String(error), { code: 'AUTH' });
      if (this.logger !== undefined) this.logger.warn('llm-qwen-subscription: sign-in failed: ' + flow.error.message);
    }
  }

  /** Report one flow's state to a polling page. */
  async loginPoll(flowId) {
    if (flowId === undefined) return failure(new QwenFailure('loginPoll needs a flowId', { code: 'BAD_REQUEST' }));
    const flow = this.flows.get(flowId);
    if (flow === undefined) return failure(new QwenFailure('that sign-in flow is unknown or already finished; start again', { code: 'AUTH' }));
    if (flow.state === 'approved') {
      this.flows.delete(flowId);
      return ok({ state: 'approved', account: flow.account });
    }
    if (flow.state === 'failed') {
      this.flows.delete(flowId);
      return failure(flow.error);
    }
    if (Date.now() > flow.expiresAt + 60000) {
      this.loginCancel(flowId);
      return failure(new QwenFailure('the device code expired before it was approved', { code: 'AUTH' }));
    }
    return ok({ state: 'pending' });
  }

  /** Stop one flow and forget it. */
  loginCancel(flowId) {
    const flow = flowId === undefined ? undefined : this.flows.get(flowId);
    if (flow === undefined) return { canceled: false }
    flow.abort.abort();
    this.flows.delete(flowId);
    return { canceled: true }
  }

  /** Drop flows nobody is watching any more. */
  pruneFlows() {
    const now = Date.now();
    for (const [flowId, flow] of this.flows) {
      if (now > flow.expiresAt + FLOW_TTL_MS) {
        flow.abort.abort();
        this.flows.delete(flowId);
      }
    }
  }
}

/**
 * Mount the `/qwen-auth` channel when this profile has a host connection.
 * @param ctx - plugin context.
 * @param controller - operations backing the endpoints.
 */
export function registerAuthRpc(ctx, controller) {
  ctx.inject(['connection'], (child) => {
    const connection = child.get('connection')
    if (connection === undefined || connection === null || typeof connection.rpc?.handle !== 'function') {
      if (ctx.logger !== undefined) ctx.logger.debug('llm-qwen-subscription: no connection service; settings page stays unavailable');
      return;
    }
    child.effect(
      () => connection.rpc.handle(AUTH_CHANNEL, (endpoint, payload) => controller.dispatch(endpoint, payload)),
      'llm-qwen-subscription: /qwen-auth settings channel',
    );
  });
}

/** Prefix of the shared-channel method names this plugin owns. */
export const AUTH_METHOD_PREFIX = 'qwen-auth.'

/** Decode one `client-request` envelope without trusting its shape. */
function readEnvelope(body) {
  if (body === null || typeof body !== 'object') return undefined;
  const record = body;
  if (record.type !== 'client-request' || typeof record.rpcId !== 'string' || typeof record.method !== 'string') return undefined;
  return { rpcId: record.rpcId, method: record.method, payload: record.payload };
}

/** Wrap one endpoint as an exact Fetch route on the shared `/api` channel. */
function routeFor(endpoint, dispatch) {
  const method = AUTH_METHOD_PREFIX + endpoint;
  return {
    path: '/api/' + method,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async (request) => {
      const mediaType = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
      if (mediaType !== 'application/json') return new Response('content type must be application/json', { status: 415 });
      let body;
      try {
        body = await request.json();
      } catch (_nonJsonBody) {
        return new Response('body is not JSON', { status: 400 });
      }
      const envelope = readEnvelope(body);
      if (envelope === undefined) {
        const rawId = body !== null && typeof body === 'object' && typeof body.rpcId === 'string' ? body.rpcId : 'invalid-request';
        return Response.json({
          type: 'server-response',
          rpcId: rawId,
          result: { ok: false, error: { code: 'BAD_REQUEST', message: 'invalid client-request message' } },
        });
      }
      if (envelope.method !== method) {
        return Response.json({
          type: 'server-response',
          rpcId: envelope.rpcId,
          result: { ok: false, error: { code: 'BAD_REQUEST', message: 'method ' + JSON.stringify(envelope.method) + ' does not match endpoint ' + JSON.stringify(method) } },
        });
      }
      const result = await dispatch(endpoint, envelope.payload, request.signal);
      return Response.json({ type: 'server-response', rpcId: envelope.rpcId, result });
    },
  };
}

/**
 * Mount the settings endpoints as exact Fetch routes on the shared `/api` channel.
 * This is the transport a browser plugin can rely on in every DSH build; the
 * dedicated `/qwen-auth` channel is registered as well when the host allows it.
 * @param ctx - plugin context.
 * @param controller - operations backing the endpoints.
 */
export function registerAuthRoutes(ctx, controller) {
  ctx.inject(['connection'], (child) => {
    const connection = child.get('connection');
    if (connection === undefined || connection === null || typeof connection.fetch?.register !== 'function') {
      if (ctx.logger !== undefined) ctx.logger.debug('llm-qwen-subscription: no connection fetch registry; settings endpoints stay unavailable');
      return;
    }
    for (const endpoint of AUTH_ENDPOINTS) {
      child.effect(
        () => connection.fetch.register(routeFor(endpoint, (name, payload, signal) => controller.dispatch(name, payload, signal))),
        'llm-qwen-subscription: /api/' + AUTH_METHOD_PREFIX + endpoint + ' route',
      );
    }
  });
}
