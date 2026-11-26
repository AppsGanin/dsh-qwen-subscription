/**
 * Account pool: which signed-in subscription a request uses, and how long an
 * account steps aside after the provider refused it.
 *
 * A pool exists so several qwen.ai subscriptions on one machine keep working when
 * one of them runs out of credits or is rate-limited: the route fails over to the
 * next account instead of failing the turn.
 */

/** Failure codes worth retrying on another account; request-level refusals are not. */
export const FAILOVER_CODES = new Set(['QUOTA', 'RATE_LIMIT', 'AUTH', 'MISSING_CREDENTIAL', 'SERVER', 'TRANSPORT'])

/** Cooldown applied when the provider names no delay. */
const DEFAULT_COOLDOWN_MS = {
  QUOTA: 3600000,
  RATE_LIMIT: 60000,
  AUTH: 900000,
  MISSING_CREDENTIAL: 900000,
  SERVER: 30000,
  TRANSPORT: 15000,
};

/**
 * Ordered account selection with per-account cooldowns.
 */
export class AccountPool {
  /**
   * @param options - `auth` reads the account store, `logger` reports failovers,
   *   `now` is injectable for tests.
   */
  constructor(options = {}) {
    this.auth = options.auth;
    this.logger = options.logger;
    this.now = options.now ?? (() => Date.now());
    this.cooldowns = new Map();
  }

  /**
   * Accounts in the order an attempt should use them: the preferred account first,
   * then the remaining accounts in store order.
   * @returns the ordered candidate accounts, possibly empty.
   */
  async candidates() {
    const state = await this.auth.state();
    if (state === undefined || !Array.isArray(state.accounts) || state.accounts.length === 0) return [];
    const preferredId = state.preferredId;
    const preferred = state.accounts.filter((account) => account.id === preferredId);
    const rest = state.accounts.filter((account) => account.id !== preferredId);
    return [...preferred, ...rest];
  }

  /** Clear one account's cooldown after a successful request. */
  markSuccess(accountId) {
    this.cooldowns.delete(accountId);
  }

  /**
   * Step one account aside for a while after a refusal.
   * @param accountId - the account that failed.
   * @param failure - the provider failure; a quota refusal carries its reset instant.
   */
  markFailure(accountId, failure) {
    const code = failure !== undefined && typeof failure.code === 'string' ? failure.code : 'SERVER';
    const resetAt = failure !== undefined && typeof failure.resetAt === 'string' ? Date.parse(failure.resetAt) : NaN;
    const retryAfter = failure !== undefined && Number.isFinite(failure.failure?.providerRetryAfterMs)
      ? failure.failure.providerRetryAfterMs
      : undefined;
    let until = Number.isFinite(resetAt) ? resetAt : undefined;
    if (until === undefined && retryAfter !== undefined) until = this.now() + retryAfter;
    if (until === undefined) until = this.now() + (DEFAULT_COOLDOWN_MS[code] ?? DEFAULT_COOLDOWN_MS.SERVER);
    if (until <= this.now()) until = this.now() + DEFAULT_COOLDOWN_MS.SERVER;
    this.cooldowns.set(accountId, { until, code });
    if (this.logger !== undefined) {
      this.logger.warn('llm-qwen-subscription: account ' + accountId + ' stepped aside until ' + new Date(until).toISOString() + ' after ' + code);
    }
  }

  /**
   * Remaining cooldown of one account.
   * @returns the ISO instant the account becomes usable again, or undefined.
   */
  cooldownOf(accountId) {
    const entry = this.cooldowns.get(accountId);
    if (entry === undefined) return undefined;
    if (entry.until <= this.now()) {
      this.cooldowns.delete(accountId);
      return undefined;
    }
    return { until: new Date(entry.until).toISOString(), code: entry.code };
  }
}

/**
 * Remember one quota refusal on the account so the settings page keeps showing it.
 * @param auth - credential service owning the store.
 * @param accountId - the refused account.
 * @param failure - the quota failure.
 * @returns the recorded quota facts.
 */
export async function recordQuotaRefusal(auth, accountId, failure) {
  const resetAt = typeof failure.resetAt === 'string' ? failure.resetAt : undefined;
  const quota = {
    exhausted: true,
    observedAt: new Date().toISOString(),
    ...(resetAt === undefined ? {} : { resetAt }),
    ...(typeof failure.failure?.message === 'string' ? { message: failure.failure.message } : {}),
  };
  await auth.recordQuota(accountId, quota);
  return quota;
}
