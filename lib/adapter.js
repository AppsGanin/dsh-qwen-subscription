/** The Qwen (qwen.ai subscription) adapter: one streaming chat-completions route. */
import { API_BASE_URL, ATTRIBUTION_USER_AGENT, DEFAULT_STREAM_IDLE_TIMEOUT_MS } from './constants.js'
import { ModelCatalog, modelInfo } from './catalog.js'
import { QwenFailure, providerFailure, signedOutFailure } from './errors.js'
import { FAILOVER_CODES, recordQuotaRefusal } from './pool.js'
import { parseSseData } from './sse.js'
import { translateStream } from './translate.js'
import { buildRequestBody, prepareMessages, requestImageTarget } from './wire.js'

/** Provider name used by selector surfaces. */
const DEFAULT_DISPLAY_NAME = 'Qwen (qwen.ai subscription)'

/** A short localized context-window badge for the model selector. */
function contextBadge(contextWindow) {
  if (!Number.isFinite(contextWindow) || contextWindow <= 0) return undefined
  const label = contextWindow >= 1000000
    ? (contextWindow / 1000000) + 'M'
    : Math.round(contextWindow / 1000) + 'K'
  return { text: { en: label + ' context', zh: label + ' 上下文' }, tone: 'neutral' }
}

/**
 * One adapter instance owning one provider route. It duck-types the harness
 * adapter surface (providerInfo, listModels, resolveModel, prepareCall, stream)
 * so this plugin needs no harness imports and cannot drift with package layout.
 *
 * When an account pool is attached, one request may try several signed-in
 * subscriptions in order: a refusal that belongs to the account (quota, rate
 * limit, dead sign-in) steps that account aside and the request continues on the
 * next one, as long as nothing has been streamed yet.
 */
export class QwenAdapter {
  constructor(options = {}) {
    this.auth = options.auth
    this.pool = options.pool
    this.logger = options.logger
    this.config = options.config ?? {}
    this.apiBase = typeof options.apiBase === 'string' ? options.apiBase : API_BASE_URL
    this.attachments = options.attachments ?? (() => undefined)
    this.usage = options.usage
    this.catalog = new ModelCatalog({ auth: this.auth, logger: this.logger, apiBase: this.apiBase })
  }

  /** Display metadata for one owned route. */
  providerInfo(provider) {
    const displayName = typeof this.config.displayName === 'string' && this.config.displayName.length > 0
      ? this.config.displayName
      : DEFAULT_DISPLAY_NAME
    return { id: provider, name: displayName }
  }

  /** Keep the harness retry defaults for this route. */
  providerRetryPolicy(provider) {
    void provider
    return undefined
  }

  /**
   * Request-image pricing owned by this route: none, so consumers fall back to
   * their own neutral estimate. The harness calls this on every adapter that can
   * carry images (compaction prices a request before it shifts the context), so a
   * duck-typed adapter must implement the base default rather than rely on it.
   * @returns undefined, meaning this route declares no image pricing.
   */
  imageRequestPricing(provider, model) {
    void provider;
    void model;
    return undefined;
  }

  /**
   * Request-image projection this route sends: the stored image unchanged, so the
   * requested size and byte budget are the image's own. Mirrors the base default.
   * @param provider - registered provider route.
   * @param model - exact model id.
   * @param image - normalized image whose request projection is being resolved.
   * @returns the same width, height, and byte budget the image already carries.
   */
  imageRequestTarget(provider, model, image) {
    void provider;
    void model;
    return requestImageTarget(image);
  }

  /** Advertised models; the static catalog keeps the selector usable while signed out. */
  async listModels(provider) {
    const entries = await this.catalog.entries()
    return entries.map((entry) => ({
      provider,
      id: entry.id,
      name: entry.name,
      inputModalities: entry.inputModalities,
      badge: contextBadge(entry.contextWindow),
    }))
  }

  /** Exact-route metadata: context capacity, output cap, and reasoning efforts. */
  async resolveModel(provider, model) {
    const entry = await this.catalog.find(model)
    return modelInfo(provider, model, entry, this.config)
  }

  /** Bind one generation's model metadata to its dispatch. */
  async prepareCall(provider, model, signal) {
    const info = await this.resolveModel(provider, model, signal)
    return { model: info, stream: (options) => this.stream(options) }
  }

  /**
   * Stream one chat completion as harness chunks, failing over between accounts.
   * @param options - the fully assembled request.
   * @returns an async iterable of StreamChunks ending in one terminal finish.
   */
  async * stream(options) {
    const consumer = new AbortController()
    const signal = options.signal === undefined
      ? consumer.signal
      : AbortSignal.any([consumer.signal, options.signal])
    try {
      signal.throwIfAborted()
      const candidates = this.pool === undefined ? [undefined] : await this.pool.candidates()
      if (candidates.length === 0) throw signedOutFailure('no account is signed in');
      let lastFailure
      for (let index = 0; index < candidates.length; index += 1) {
        const account = candidates[index]
        let emitted = false
        try {
          for await (const chunk of this.attempt(options, account, signal)) {
            emitted = true
            yield chunk
          }
          if (this.pool !== undefined && account !== undefined) {
            this.pool.markSuccess(account.id);
            if (account.quota !== undefined) {
              try {
                await this.auth.clearQuota(account.id);
              } catch (_staleQuotaFailure) {
                /* bookkeeping only */
              }
            }
          }
          return
        } catch (error) {
          const failure = error instanceof QwenFailure ? error : undefined
          const failover = this.pool !== undefined && account !== undefined && !emitted
            && failure !== undefined && FAILOVER_CODES.has(failure.code)
            && index < candidates.length - 1
          if (!failover) throw error
          lastFailure = failure
          this.pool.markFailure(account.id, failure)
          if (failure.code === 'QUOTA') {
            try {
              await recordQuotaRefusal(this.auth, account.id, failure)
            } catch (_quotaBookkeepingFailure) {
              /* the refusal itself is what the caller sees */
            }
          }
        }
      }
      throw lastFailure ?? new QwenFailure('no Qwen account could serve this request', { code: 'QUOTA' })
    } catch (error) {
      if (signal.aborted) throw new QwenFailure('Qwen request aborted', { code: 'ABORTED', cause: error })
      if (error instanceof QwenFailure) throw error
      const message = error instanceof Error ? error.message : String(error)
      throw new QwenFailure('Qwen transport failed: ' + message, { code: 'TRANSPORT', cause: error })
    } finally {
      consumer.abort()
    }
  }

  /** One attempt on one account: build, send, translate, with an idle watchdog. */
  async * attempt(options, account, signal) {
    signal.throwIfAborted()
    const idleMs = Number.isFinite(this.config.streamIdleTimeoutMs) && this.config.streamIdleTimeoutMs > 0
      ? this.config.streamIdleTimeoutMs
      : DEFAULT_STREAM_IDLE_TIMEOUT_MS
    const idle = new AbortController()
    const combined = AbortSignal.any([signal, idle.signal])
    let timer = setTimeout(() => idle.abort(), idleMs)
    const pulse = () => { clearTimeout(timer); timer = setTimeout(() => idle.abort(), idleMs) }
    try {
      const messages = await prepareMessages(options, { attachments: this.attachments(), signal })
      const body = buildRequestBody(options, messages, this.config)
      const response = await this.send(body, account, combined)
      pulse()
      if (response.body === null) {
        throw new QwenFailure('Qwen returned no response body', { code: 'EMPTY_RESPONSE', status: response.status })
      }
      let lastUsage
      for await (const chunk of translateStream(parseSseData(response.body), {
        model: options.model,
        status: response.status,
        headers: response.headers,
      })) {
        pulse()
        if (chunk.type === 'usage') lastUsage = chunk.usage
        yield chunk
      }
      if (this.usage !== undefined && account !== undefined && lastUsage !== undefined) {
        try {
          await this.usage.record(account.id, options.model, lastUsage)
        } catch (_usageBookkeeping) {
          /* statistics only */
        }
      }
    } catch (error) {
      if (idle.signal.aborted && !signal.aborted) {
        throw new QwenFailure('Qwen stream idle timeout', { code: 'TIMEOUT', cause: error })
      }
      throw error
    } finally {
      clearTimeout(timer)
      idle.abort()
    }
  }

  /** POST one streaming request for one account, refreshing that account once on a 401. */
  async send(body, account, signal) {
    const accountId = account === undefined ? undefined : account.id
    let token = await this.auth.accessToken({ accountId, signal })
    let response = await this.post(body, token, signal)
    if (response.status === 401) {
      token = await this.auth.accessToken({ accountId, force: true, signal })
      response = await this.post(body, token, signal)
    }
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw providerFailure(response.status, text, response.headers)
    }
    return response
  }

  /** One transport attempt; a network rejection becomes a stable transport failure. */
  async post(body, token, signal) {
    try {
      return await fetch(this.apiBase + '/chat/completions', {
        method: 'POST',
        signal,
        redirect: 'error',
        headers: {
          'content-type': 'application/json',
          accept: 'text/event-stream',
          authorization: 'Bearer ' + token,
          'user-agent': ATTRIBUTION_USER_AGENT,
        },
        body: JSON.stringify(body),
      })
    } catch (error) {
      if (signal.aborted) throw new QwenFailure('Qwen request aborted', { code: 'ABORTED', cause: error })
      const message = error instanceof Error ? error.message : String(error)
      throw new QwenFailure('Qwen request failed: ' + message, { code: 'TRANSPORT', cause: error })
    }
  }
}
