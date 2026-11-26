/**
 * Account store of the Qwen subscription plugin: one file holding every signed-in
 * account, the preferred account, and the last quota refusal each account met.
 *
 * Version 2 replaces the single-token file of version 1; a version-1 file is
 * migrated on read so an upgrade needs no manual step.
 */
import { randomUUID } from 'node:crypto'
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { AUTH_FILE, CLIENT_ID, PLUGIN_VERSION } from './constants.js'
import { QwenFailure } from './errors.js'

/** Store layout version this build writes. */
export const STORE_VERSION = 2

/** Absolute path of the credential store, overridable for tests. */
export function authFilePath() {
  const override = process.env.DSH_QWEN_AUTH_FILE
  return typeof override === 'string' && override.length > 0 ? override : AUTH_FILE
}

/** Fresh account identity. */
function newAccountId() {
  return 'acc_' + randomUUID().slice(0, 8)
}

/** Normalize one token record, accepting both field spellings seen in the wild. */
export function normalizeTokens(tokens) {
  if (tokens === null || typeof tokens !== 'object') return undefined
  if (typeof tokens.access_token !== 'string' || tokens.access_token.length === 0) return undefined
  const rawExpiry = Number.isFinite(tokens.expires_at) ? tokens.expires_at : tokens.expiresAt
  return {
    access_token: tokens.access_token,
    refresh_token: typeof tokens.refresh_token === 'string' ? tokens.refresh_token : undefined,
    token_type: typeof tokens.token_type === 'string' ? tokens.token_type : 'Bearer',
    scope: typeof tokens.scope === 'string' ? tokens.scope : undefined,
    expires_in: Number.isFinite(tokens.expires_in) ? tokens.expires_in : undefined,
    expires_at: Number.isFinite(rawExpiry) ? rawExpiry : undefined,
  }
}

/** Human-readable account label: explicit label, then email, then the id. */
export function accountLabel(account) {
  if (typeof account.label === 'string' && account.label.length > 0) return account.label
  const email = account.account !== null && typeof account.account === 'object' ? account.account.email : undefined
  return typeof email === 'string' && email.length > 0 ? email : account.id
}

/** Normalize one stored account, dropping records without a usable token. */
function normalizeAccount(account) {
  if (account === null || typeof account !== 'object') return undefined
  const tokens = normalizeTokens(account.tokens)
  if (tokens === undefined) return undefined
  const info = account.account !== null && typeof account.account === 'object' ? account.account : undefined
  return {
    id: typeof account.id === 'string' && account.id.length > 0 ? account.id : newAccountId(),
    label: typeof account.label === 'string' ? account.label : undefined,
    name: typeof account.name === 'string' ? account.name : (info && typeof info.name === 'string' ? info.name : undefined),
    memberType: typeof account.memberType === 'string' ? account.memberType : (info && typeof info.member_type === 'string' ? info.member_type : undefined),
    tokens,
    account: info,
    addedAt: typeof account.addedAt === 'string' ? account.addedAt : undefined,
    updatedAt: typeof account.updatedAt === 'string' ? account.updatedAt : undefined,
    quota: account.quota !== null && typeof account.quota === 'object' ? account.quota : undefined,
  }
}

/** Empty store for a machine that never signed in. */
function emptyState() {
  return { version: STORE_VERSION, plugin: 'dsh-llm-qwen-subscription', clientId: CLIENT_ID, accounts: [], preferredId: undefined };
}

/** Turn any stored shape into a version-2 state. */
export function normalizeState(raw) {
  if (raw === null || typeof raw !== 'object') return emptyState()
  const clientId = typeof raw.clientId === 'string' ? raw.clientId : CLIENT_ID
  if (Array.isArray(raw.accounts)) {
    const accounts = raw.accounts.map(normalizeAccount).filter((account) => account !== undefined)
    const preferredId = typeof raw.preferredId === 'string' && accounts.some((account) => account.id === raw.preferredId)
      ? raw.preferredId
      : undefined
    return { version: STORE_VERSION, plugin: 'dsh-llm-qwen-subscription', clientId, accounts, preferredId };
  }
  const tokens = normalizeTokens(raw.tokens)
  if (tokens === undefined) return { ...emptyState(), clientId }
  const info = raw.account !== null && typeof raw.account === 'object' ? raw.account : undefined
  const account = normalizeAccount({
    id: info && typeof info.sub === 'string' && info.sub.length >= 6 ? 'acc_' + info.sub.slice(0, 8) : newAccountId(),
    label: info && typeof info.email === 'string' ? info.email : undefined,
    tokens,
    account: info,
    addedAt: typeof raw.signedInAt === 'string' ? raw.signedInAt : undefined,
    updatedAt: typeof raw.updated_at === 'string' ? raw.updated_at : undefined,
  });
  if (account === undefined) return { ...emptyState(), clientId }
  return { version: STORE_VERSION, plugin: 'dsh-llm-qwen-subscription', clientId, accounts: [account], preferredId: account.id };
}

/** Read the store, normalized; undefined when this machine never signed in. */
export async function readState(file = authFilePath()) {
  let raw
  try {
    raw = await readFile(file, 'utf8')
  } catch (error) {
    if (error !== null && typeof error === 'object' && error.code === 'ENOENT') return undefined
    throw new QwenFailure('Qwen credential file is unreadable: ' + (error instanceof Error ? error.message : String(error)), { code: 'INVALID_CREDENTIAL' })
  }
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (_invalidJsonStore) {
    throw new QwenFailure('Qwen credential file is not valid JSON: ' + file, { code: 'INVALID_CREDENTIAL' })
  }
  return normalizeState(parsed)
}

/** Write the store atomically with owner-only permissions. */
export async function writeState(state, file = authFilePath()) {
  await mkdir(dirname(file), { recursive: true, mode: 0o700 })
  const temp = file + '.' + String(process.pid) + '.tmp'
  const body = {
    version: STORE_VERSION,
    plugin: 'dsh-llm-qwen-subscription',
    pluginVersion: PLUGIN_VERSION,
    clientId: state.clientId ?? CLIENT_ID,
    updated_at: new Date().toISOString(),
    ...(state.preferredId === undefined ? {} : { preferredId: state.preferredId }),
    accounts: state.accounts,
  };
  await writeFile(temp, JSON.stringify(body, null, 2) + '\n', { mode: 0o600 });
  await chmod(temp, 0o600);
  await rename(temp, file);
}

/** Serialized read-modify-write so two requests cannot clobber one another. */
let writeChain = Promise.resolve();
/**
 * Run one store transaction with exclusive ownership.
 * @param mutate - receives the current state (or an empty one) and returns the next state plus a result.
 * @returns the transaction's result; the state is written only when refused is false.
 */
export function transactState(mutate) {
  const run = writeChain.then(async () => {
    const current = (await readState()) ?? emptyState()
    const outcome = await mutate(current)
    if (outcome === undefined) return undefined
    if (outcome.state !== undefined) await writeState(outcome.state)
    return outcome.result
  });
  writeChain = run.then(() => undefined, () => undefined);
  return run;
}

/** Find one account by id, else the preferred one, else the first. */
export function pickAccount(state, accountId) {
  if (state === undefined || !Array.isArray(state.accounts) || state.accounts.length === 0) return undefined
  if (typeof accountId === 'string' && accountId.length > 0) {
    const wanted = state.accounts.find((account) => account.id === accountId)
    if (wanted !== undefined) return wanted
  }
  if (typeof state.preferredId === 'string') {
    const preferred = state.accounts.find((account) => account.id === state.preferredId)
    if (preferred !== undefined) return preferred
  }
  return state.accounts[0]
}

/** Add or update one account from a completed sign-in. */
export function upsertAccount(state, input) {
  const tokens = normalizeTokens(input.tokens)
  if (tokens === undefined) throw new QwenFailure('a Qwen sign-in produced no access token', { code: 'AUTH' })
  const info = input.account !== null && typeof input.account === 'object' ? input.account : undefined
  const email = info !== undefined && typeof info.email === 'string' ? info.email : undefined
  const existing = state.accounts.find((account) => (
    info !== undefined && typeof info.sub === 'string' && account.account !== null && typeof account.account === 'object'
      ? account.account.sub === info.sub
      : email !== undefined && accountLabel(account) === email
  ));
  const now = new Date().toISOString();
  if (existing !== undefined) {
    const updated = {
      ...existing,
      tokens,
      account: info ?? existing.account,
      name: (info !== undefined && typeof info.name === 'string' ? info.name : undefined) ?? existing.name,
      memberType: (info !== undefined && typeof info.member_type === 'string' ? info.member_type : undefined) ?? existing.memberType,
      label: typeof input.label === 'string' && input.label.length > 0 ? input.label : existing.label,
      quota: undefined,
      updatedAt: now,
    };
    return {
      state: { ...state, accounts: state.accounts.map((account) => account.id === existing.id ? updated : account) },
      account: updated,
    };
  }
  const account = normalizeAccount({
    id: info !== undefined && typeof info.sub === 'string' && info.sub.length >= 6 ? 'acc_' + info.sub.slice(0, 8) : newAccountId(),
    label: typeof input.label === 'string' && input.label.length > 0 ? input.label : email,
    tokens,
    account: info,
    addedAt: now,
    updatedAt: now,
  });
  if (account === undefined) throw new QwenFailure('a Qwen sign-in produced an unusable account record', { code: 'AUTH' })
  return {
    state: {
      ...state,
      accounts: [...state.accounts, account],
      preferredId: state.preferredId ?? account.id,
    },
    account,
  };
}
