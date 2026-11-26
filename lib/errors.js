/** Provider failures normalized into the harness's stable failure vocabulary. */

/**
 * One Qwen failure. The harness reads `code` and the frozen `failure` snapshot, so
 * this class carries both even across package boundaries.
 */
export class QwenFailure extends Error {
  /**
   * @param message - human-readable failure text.
   * @param options - stable code plus optional provider facts.
   */
  constructor(message, options = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    const code = typeof options.code === 'string' && options.code.length > 0 ? options.code : 'SERVER'
    const failure = { message: message.length > 0 ? message : 'Qwen request failed', code }
    if (Number.isInteger(options.status) && options.status >= 100 && options.status <= 599) failure.status = options.status
    if (typeof options.requestId === 'string' && options.requestId.length > 0) failure.requestId = options.requestId
    if (Number.isFinite(options.retryAfterMs) && options.retryAfterMs > 0) failure.providerRetryAfterMs = Math.round(options.retryAfterMs)
    this.name = 'QwenFailure'
    this.code = code
    this.failure = Object.freeze(failure)
    // Not part of the harness failure vocabulary: a quota reset instant is account
    // bookkeeping this plugin shows in Settings and uses for pool cooldowns.
    if (typeof options.resetAt === 'string' && options.resetAt.length > 0) this.resetAt = options.resetAt
  }
}

/** Failure raised when no usable subscription token exists. */
export function signedOutFailure(detail) {
  const hint = detail ? ' (' + detail + ')' : ''
  return new QwenFailure(
    'Qwen subscription is not signed in. Run `dsh-qwen-login` (or `node bin/qwen-login.mjs` in the plugin) to approve this device.' + hint,
    { code: 'MISSING_CREDENTIAL' },
  )
}

/** Read one header defensively; response header bags differ between runtimes. */
function headerValue(headers, name) {
  if (headers === undefined || headers === null) return undefined
  const value = typeof headers.get === 'function' ? headers.get(name) : headers[name]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/** Parse a provider error body without trusting its shape. */
function errorEnvelope(text) {
  if (typeof text !== 'string' || text.length === 0) return {}
  let parsed
  try { parsed = JSON.parse(text) } catch (_nonJsonGatewayError) { return { message: text.slice(0, 500) } }
  if (typeof parsed !== 'object' || parsed === null) return { message: text.slice(0, 500) }
  const error = typeof parsed.error === 'object' && parsed.error !== null ? parsed.error : parsed
  const message = typeof error.message === 'string' && error.message.length > 0
    ? error.message
    : typeof parsed.message === 'string' && parsed.message.length > 0 ? parsed.message : undefined
  return {
    type: typeof error.type === 'string' ? error.type : typeof parsed.type === 'string' ? parsed.type : undefined,
    code: typeof error.code === 'string' ? error.code : undefined,
    message,
    requestId: typeof error.request_id === 'string' ? error.request_id
      : typeof parsed.request_id === 'string' ? parsed.request_id : undefined,
    resetAt: typeof parsed.resetAt === 'string' ? parsed.resetAt
      : typeof parsed.reset_at === 'string' ? parsed.reset_at : undefined,
    raw: text.slice(0, 500),
  }
}

/** Provider-requested retry delay in milliseconds, when the response names one. */
function retryDelay(headers) {
  const raw = headerValue(headers, 'retry-after')
  if (raw === undefined) return undefined
  if (/^[0-9]+(?:\.[0-9]+)?$/u.test(raw)) return Number(raw) * 1000
  const at = Date.parse(raw)
  return Number.isFinite(at) ? at - Date.now() : undefined
}

/**
 * Classify one provider refusal into the harness failure vocabulary.
 * @param status - HTTP status, or the status whose stream carried an in-band error.
 * @param bodyText - response text, JSON or not.
 * @param headers - response headers.
 * @param fallback - message used when the provider names none.
 * @returns a QwenFailure ready to throw.
 */
export function providerFailure(status, bodyText, headers, fallback) {
  const envelope = errorEnvelope(bodyText)
  const detail = [envelope.type, envelope.code, envelope.message].filter((part) => typeof part === 'string' && part.length > 0).join(' ')
  const message = envelope.message ?? fallback ?? 'Qwen request failed (' + (status ?? 'stream') + ')'
  const detailText = detail.length > 0 ? detail : envelope.raw
  let code = 'SERVER'
  if (status === 401 || status === 403) code = 'AUTH'
  else if (envelope.type === 'subscription_quota' || envelope.type === 'insufficient_quota' || status === 402) code = 'QUOTA'
  else if (status === 429) code = 'RATE_LIMIT'
  else if (/context (?:window|length)|maximum context|too many tokens/iu.test(detailText ?? '')) code = 'CONTEXT_WINDOW_EXCEEDED'
  else if (/insufficient|quota|credit|balance/iu.test(detailText ?? '') && status !== undefined && status < 500) code = 'QUOTA'
  else if (status === 400 || status === 413 || status === 422) code = 'INVALID_REQUEST'
  else if (status !== undefined && status >= 500) code = 'SERVER'
  else if (status !== undefined) code = 'HTTP_' + status
  const requestId = headerValue(headers, 'x-request-id')
    ?? headerValue(headers, 'x-gateway-request-id')
    ?? envelope.requestId
  return new QwenFailure(message, {
    code,
    status,
    requestId,
    retryAfterMs: retryDelay(headers),
    resetAt: envelope.resetAt,
  })
}
