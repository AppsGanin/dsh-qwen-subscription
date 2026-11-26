#!/usr/bin/env node
/**
 * Sign a qwen.ai subscription in (or out) from the terminal, using the same
 * device flow and the same account store the harness plugin reads.
 *
 *   dsh-qwen-login              approve in the browser, then wait for the token
 *   dsh-qwen-login --no-browser print the URL instead of opening it
 *   dsh-qwen-login --json       machine-readable result
 *   dsh-qwen-login --sign-out   revoke every stored account and forget them
 */
import { spawn } from 'node:child_process'
import {
  QwenAuth, authorizeUrlFor, fetchUserInfo, pollDeviceToken, requestDeviceCode, tokensFromPayload,
} from '../lib/auth.js'
import { accountLabel, authFilePath } from '../lib/store.js'
import { QwenFailure } from '../lib/errors.js'

const args = process.argv.slice(2)
const flags = new Set(args.filter((arg) => arg.startsWith('--')))
const noBrowser = flags.has('--no-browser')
const asJson = flags.has('--json')
const signOut = flags.has('--sign-out')

function say(line) {
  if (!asJson) process.stdout.write(line + '\n')
}

function emit(payload) {
  if (asJson) process.stdout.write(JSON.stringify(payload, null, 2) + '\n')
}

/** Open one URL with the platform handler, ignoring every failure. */
function openBrowser(url) {
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open'
  const argv = process.platform === 'win32' ? ['/c', 'start', '', url] : [url]
  try {
    const child = spawn(command, argv, { stdio: 'ignore', detached: true });
    child.on('error', () => {});
    child.unref();
  } catch (_noBrowserHandler) {
    /* the printed URL is the fallback */
  }
}

async function runSignOut(auth) {
  const state = await auth.state()
  const existing = state === undefined ? 0 : state.accounts.length
  if (existing === 0) {
    say('No Qwen account is stored at ' + authFilePath());
    emit({ signedOut: 0, file: authFilePath() });
    return 0;
  }
  const result = await auth.signOut();
  say('Signed out of ' + String(result.signedOut) + ' Qwen account(s)' + (result.revoked ? ' and revoked the tokens.' : '; the provider did not confirm revocation.'));
  emit({ ...result, file: authFilePath() });
  return 0;
}

async function runLogin(auth) {
  const device = await requestDeviceCode()
  const url = authorizeUrlFor(device.user_code)
  say('');
  say('Qwen subscription sign-in');
  say('  1. Open: ' + url);
  say('  2. Confirm the code ' + device.user_code + ' for the Qwen Code client.');
  say('  3. Return here; this command finishes on its own within ' + String(Math.round(device.expires_in / 60)) + ' minutes.');
  say('');
  emit({ stage: 'awaiting-approval', userCode: device.user_code, url, expiresAt: new Date(device.expires_at).toISOString() });
  if (!noBrowser) openBrowser(url);
  const payload = await pollDeviceToken(device)
  const tokens = tokensFromPayload(payload)
  const account = await fetchUserInfo(tokens.access_token)
  const stored = await auth.signIn({ tokens, account })
  const state = await auth.state()
  const total = state === undefined ? 1 : state.accounts.length
  say('Signed in as ' + accountLabel(stored) + '.');
  say('Accounts in the pool: ' + String(total) + ' (the plugin tries the preferred one first).');
  say('Credentials: ' + authFilePath() + ' (mode 0600)');
  say('Access token expires at ' + new Date(stored.tokens.expires_at).toISOString() + '; the plugin refreshes it automatically.');
  emit({
    signedIn: true,
    account: { id: stored.id, label: accountLabel(stored) },
    accounts: total,
    file: authFilePath(),
    expiresAt: new Date(stored.tokens.expires_at).toISOString(),
  });
  return 0;
}

const auth = new QwenAuth({ logger: { debug() {}, info() {}, warn() {} } });
try {
  process.exitCode = signOut ? await runSignOut(auth) : await runLogin(auth);
} catch (error) {
  const message = error instanceof QwenFailure || error instanceof Error ? error.message : String(error);
  process.stderr.write('qwen-login failed: ' + message + '\n');
  emit({ error: message });
  process.exitCode = 1;
}
