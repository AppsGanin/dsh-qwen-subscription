/**
 * dsh-llm-qwen-subscription: register the Qwen (qwen.ai subscription) route on
 * the harness LLM service, plus the `/qwen-auth` channel the web settings page
 * drives to sign accounts in and out.
 * @module dsh-llm-qwen-subscription
 */
import { DEFAULT_PROVIDER } from './constants.js'
import { QwenAdapter } from './adapter.js'
import { QwenAuth } from './auth.js'
import { AccountPool } from './pool.js'
import { AuthController, registerAuthRoutes, registerAuthRpc } from './rpc.js'
import { UsageLedger } from './usage.js'

export const name = 'dsh-llm-qwen-subscription'

/** The LLM registry is required; the settings channel mounts when `connection` exists. */
export const inject = ['llm']

/**
 * Mount the provider route and, on a web composition, the settings channel.
 * @param ctx - plugin context carrying the LLM registry and an attachment store.
 * @param config - optional provider route name, display name, output cap, default effort, endpoint.
 */
/**
 * Answer unknown adapter members instead of letting the runtime crash on them.
 *
 * This adapter duck-types the harness base class rather than extending it, and the
 * harness calls members outside the stream path (image pricing during compaction,
 * for one). A member that exists on a newer base class but not here would surface as
 * "is not a function" in the middle of a model switch, so an unknown member logs
 * once and answers undefined; a known one is bound to the adapter.
 * @param adapter - the concrete adapter instance.
 * @param logger - plugin logger used for the one-time diagnostic.
 * @returns the adapter with a defensive member lookup.
 */
function guardAdapter(adapter, logger) {
  const reported = new Set();
  return new Proxy(adapter, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (value !== undefined) return typeof value === 'function' ? value.bind(target) : value;
      if (typeof property !== 'string') return value;
      if (!reported.has(property)) {
        reported.add(property);
        logger.warn('llm-qwen-subscription: the harness called adapter.' + property + '(); this plugin does not implement it (missing LlmAdapter member?) and answered undefined');
      }
      return () => undefined;
    },
  });
}

export function apply(ctx, config = {}) {
  const provider = typeof config.provider === 'string' && config.provider.length > 0
    ? config.provider
    : DEFAULT_PROVIDER
  const auth = new QwenAuth({ logger: ctx.logger })
  const pool = new AccountPool({ auth, logger: ctx.logger })
  const usage = new UsageLedger()
  const adapter = new QwenAdapter({
    auth,
    pool,
    usage,
    logger: ctx.logger,
    config,
    apiBase: config.apiBase,
    attachments: () => ctx.get('attachments'),
  })
  ctx.llm.registerAdapter([provider], guardAdapter(adapter, ctx.logger))
  const controller = new AuthController({
    auth,
    pool,
    usage,
    adapter,
    provider,
    logger: ctx.logger,
    onSignedIn: () => {
      try {
        ctx.emit('llm/models-updated', provider)
      } catch (_emitFailure) {
        /* a catalog notification must not fail a sign-in */
      }
    },
  })
  registerAuthRoutes(ctx, controller)
  registerAuthRpc(ctx, controller)
  ctx.logger.debug('llm-qwen-subscription: registered provider route ' + provider)
  void auth.state().then(
    (state) => {
      const count = state === undefined ? 0 : state.accounts.length
      if (count === 0) {
        ctx.logger.warn('llm-qwen-subscription: no Qwen account is signed in yet; open Settings -> Qwen (or run dsh-qwen-login)');
      } else {
        ctx.logger.debug('llm-qwen-subscription: ' + String(count) + ' Qwen account(s) available');
      }
    },
    (error) => {
      const message = error instanceof Error ? error.message : String(error)
      ctx.logger.warn('llm-qwen-subscription: credential store unreadable: ' + message)
    },
  )
}
