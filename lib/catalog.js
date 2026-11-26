/** Model catalog for the Qwen subscription route: endpoint discovery with a static fallback. */
import {
  API_BASE_URL, ATTRIBUTION_USER_AGENT, CATALOG_TIMEOUT_MS, CATALOG_TTL_MS,
  DEFAULT_CONTEXT_WINDOW, DEFAULT_MAX_TOKENS, DEFAULT_MODELS, REASONING_EFFORTS,
} from './constants.js'

/** Modalities this route can carry; the provider may also advertise video, which the harness has no vocabulary for. */
const MODALITIES = ['text', 'image']

/** Human-readable name for a model id the endpoint discloses without one. */
function displayNameOf(id) {
  return id.split('-').map((part) => part.length === 0 ? part : part[0].toUpperCase() + part.slice(1)).join(' ')
}

/** Catalog rows used before discovery and whenever discovery fails. */
export function staticEntries() {
  return DEFAULT_MODELS.map((model) => ({
    id: model.id,
    name: model.name,
    contextWindow: DEFAULT_CONTEXT_WINDOW,
    inputModalities: MODALITIES,
  }))
}

/** Normalize one model row returned by the endpoint. */
function normalizeEntry(raw) {
  if (raw === null || typeof raw !== 'object') return undefined
  if (typeof raw.id !== 'string' || raw.id.trim().length === 0) return undefined
  const id = raw.id.trim()
  const contextWindow = Number.isFinite(raw.context_window_tokens) && raw.context_window_tokens > 0
    ? Math.round(raw.context_window_tokens)
    : DEFAULT_CONTEXT_WINDOW
  const declared = Array.isArray(raw.input_modalities) ? raw.input_modalities : undefined
  const inputModalities = declared === undefined
    ? MODALITIES
    : MODALITIES.filter((modality) => modality === 'text' || declared.includes(modality))
  return {
    id,
    name: typeof raw.name === 'string' && raw.name.length > 0 ? raw.name : displayNameOf(id),
    contextWindow,
    inputModalities,
  }
}

/** Resolved model metadata for one exact route. */
export function modelInfo(provider, model, entry, config = {}) {
  const contextWindow = entry !== undefined && Number.isFinite(entry.contextWindow)
    ? entry.contextWindow
    : DEFAULT_CONTEXT_WINDOW
  const defaultMaxTokens = Number.isFinite(config.maxTokens) && config.maxTokens > 0
    ? Math.round(config.maxTokens)
    : DEFAULT_MAX_TOKENS
  return {
    provider,
    id: model,
    name: entry !== undefined && typeof entry.name === 'string' ? entry.name : model,
    inputModalities: entry !== undefined && Array.isArray(entry.inputModalities) ? entry.inputModalities : MODALITIES,
    context: { contextWindow },
    defaultMaxTokens,
    reasoning: {
      efforts: REASONING_EFFORTS,
      defaultEffort: typeof config.defaultReasoningEffort === 'string' ? config.defaultReasoningEffort : 'medium',
    },
  }
}

/**
 * Owns one route's advertised models: a short-lived discovery cache over the
 * endpoint's own model listing, with a static catalog for signed-out or
 * unreachable states so the selector still offers the known models.
 */
export class ModelCatalog {
  constructor(options = {}) {
    this.auth = options.auth
    this.logger = options.logger
    this.apiBase = typeof options.apiBase === 'string' ? options.apiBase : API_BASE_URL
    this.entriesCache = undefined
    this.expiresAt = 0
    this.inflight = undefined
  }

  /** Entries this route advertises right now. */
  async entries() {
    if (this.entriesCache !== undefined && Date.now() < this.expiresAt) return this.entriesCache
    if (this.inflight !== undefined) return this.inflight
    this.inflight = this.discover().finally(() => { this.inflight = undefined })
    return this.inflight
  }

  /** The entry for one exact model id, when the catalog knows it. */
  async find(model) {
    const entries = await this.entries()
    return entries.find((entry) => entry.id === model)
  }

  /** Drop the cache so the next read interrogates the endpoint again. */
  invalidate() {
    this.entriesCache = undefined
    this.expiresAt = 0
  }

  /** Interrogate the endpoint once; any failure falls back to the static catalog. */
  async discover() {
    const fallback = staticEntries()
    if (this.auth === undefined) return fallback
    let token
    try {
      token = await this.auth.accessToken()
    } catch (error) {
      return fallback
    }
    let payload = await this.request(token)
    if (payload === undefined) {
      try {
        token = await this.auth.accessToken({ force: true })
        payload = await this.request(token)
      } catch (error) {
        payload = undefined
      }
    }
    if (payload === undefined) return fallback
    const rows = Array.isArray(payload.data) ? payload.data : Array.isArray(payload.models) ? payload.models : []
    const entries = rows.map(normalizeEntry).filter((entry) => entry !== undefined)
    if (entries.length === 0) return fallback
    this.entriesCache = entries
    this.expiresAt = Date.now() + CATALOG_TTL_MS
    return entries
  }

  /** One catalog interrogation; undefined on any refusal or failure. */
  async request(token) {
    let response
    try {
      response = await fetch(this.apiBase + '/models', {
        headers: {
          authorization: 'Bearer ' + token,
          accept: 'application/json',
          'user-agent': ATTRIBUTION_USER_AGENT,
        },
        signal: AbortSignal.timeout(CATALOG_TIMEOUT_MS),
      })
    } catch (error) {
      return undefined
    }
    if (!response.ok) return undefined
    try {
      return await response.json()
    } catch (error) {
      return undefined
    }
  }
}
