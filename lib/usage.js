/**
 * Per-account usage ledger: cumulative request and token counters fed by each
 * successful stream, stored next to the credential file and shown in Settings.
 *
 * Only aggregates are kept (no per-request history), so the file stays bounded.
 */
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { authFilePath, withCredentialLock } from './store.js'

/** Usage file paired with the credential file. */
export function usageFilePath() {
  return authFilePath() + '.usage.json'
}

function emptyLedger() {
  return { version: 1, accounts: {} }
}

/** Cumulative per-account usage counters. */
export class UsageLedger {
  constructor(options = {}) {
    this.file = options.file ?? usageFilePath()
  }

  async read() {
    let raw
    try {
      raw = await readFile(this.file, 'utf8')
    } catch (error) {
      return emptyLedger()
    }
    try {
      const parsed = JSON.parse(raw)
      if (parsed === null || typeof parsed !== 'object' || typeof parsed.accounts !== 'object' || parsed.accounts === null) return emptyLedger()
      return parsed
    } catch (_invalidJson) {
      return emptyLedger()
    }
  }

  async write(data) {
    await mkdir(dirname(this.file), { recursive: true, mode: 0o700 })
    const temp = this.file + '.' + String(process.pid) + '.tmp'
    await writeFile(temp, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 })
    await chmod(temp, 0o600)
    await rename(temp, this.file)
  }

  /**
   * Add one successful request's usage to an account's totals and to that
   * model's counters.
   * @param accountId - the account that served the request.
   * @param model - the model id that served the request.
   * @param usage - the harness TokenUsage counters.
   */
  async record(accountId, model, usage) {
    if (typeof accountId !== 'string' || accountId.length === 0) return
    if (usage === null || typeof usage !== 'object') return
    const input = Number.isFinite(usage.inputTokens) ? usage.inputTokens : 0
    const output = Number.isFinite(usage.outputTokens) ? usage.outputTokens : 0
    return withCredentialLock(async () => {
      const data = await this.read()
      const entry = data.accounts[accountId] ?? { requests: 0, inputTokens: 0, outputTokens: 0 }
      if (entry.models === null || typeof entry.models !== 'object') entry.models = {}
      entry.requests += 1
      entry.inputTokens += input
      entry.outputTokens += output
      entry.lastAt = new Date().toISOString()
      if (typeof model === 'string' && model.length > 0) {
        const perModel = entry.models[model] ?? { requests: 0, inputTokens: 0, outputTokens: 0 }
        perModel.requests += 1
        perModel.inputTokens += input
        perModel.outputTokens += output
        entry.models[model] = perModel
      }
      data.accounts[accountId] = entry
      await this.write(data)
    }, { file: this.file })
  }

  /** @returns the per-account totals map. */
  async totals() {
    const data = await this.read()
    return data.accounts
  }
}
