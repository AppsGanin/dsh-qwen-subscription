/** Endpoints, defaults, and static catalog for the Qwen (qwen.ai) subscription route. */
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Qwen OAuth service that issues device codes and tokens. */
export const AUTH_BASE_URL = 'https://auth.qwen.ai'
/** OpenAI-compatible inference endpoint the subscription token unlocks. */
export const API_BASE_URL = 'https://api.qwen.ai/compatible-mode/v1'
/** Browser page where the user approves a device code. */
export const AUTHORIZE_URL = 'https://chat.qwen.ai/authorize'
/** Public OAuth client id of the Qwen Code CLI; the subscription token is scoped to it. */
export const CLIENT_ID = 'qwen-code-cli'
/** Scopes the CLI client requests for subscription inference. */
export const OAUTH_SCOPE = 'model:invoke profile:read'
/** OAuth grant type of the device-code flow (RFC 8628). */
export const DEVICE_CODE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code'
/** Route name the adapter registers unless configuration renames it. */
export const DEFAULT_PROVIDER = 'qwen'
/** Plugin-owned credential directory under the harness home. */
export const AUTH_DIR = join(homedir(), '.dsh', 'plugins', 'qwen-subscription')
/** Plugin-owned credential file; never the qwen CLI file, whose refresh token rotates. */
export const AUTH_FILE = join(AUTH_DIR, 'auth.json')
/** Refresh this long before the access token expires, so a request never starts with a dead token. */
export const REFRESH_MARGIN_MS = 120000
/** Fallback context window when the endpoint discloses none. */
export const DEFAULT_CONTEXT_WINDOW = 1000000
/** Per-request output cap materialized when the caller names none. */
export const DEFAULT_MAX_TOKENS = 32768
/** How long a discovered model catalog stays valid. */
export const CATALOG_TTL_MS = 600000
/** Bound on one catalog interrogation. */
export const CATALOG_TIMEOUT_MS = 10000

/** Abort a stream that produces no chunk for this long, so a stalled provider cannot hang a turn. */
export const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 120000
/** This plugin's version, used in the attribution User-Agent. */
export const PLUGIN_VERSION = '0.1.0'
/**
 * App-attribution User-Agent every provider request sends: the harness product
 * identity plus this adapter, so Qwen traffic stays attributable.
 */
export const ATTRIBUTION_USER_AGENT =
  'deepseek-harness (+https://github.com/deepseek-ai/deepseek-harness) dsh-llm-qwen-subscription/' + PLUGIN_VERSION

/** Reason selectable reasoning efforts, least to greatest. */
export const REASONING_EFFORTS = [
  { id: 'off', name: 'Off' },
  { id: 'low', name: 'Low' },
  { id: 'medium', name: 'Medium' },
  { id: 'high', name: 'High' },
]

/**
 * Catalog used before a successful discovery and whenever discovery fails.
 * Ids and context windows mirror what the subscription endpoint reports.
 */
export const DEFAULT_MODELS = [
  { id: 'qwen4-max', name: 'Qwen4 Max' },
  { id: 'qwen3.8-max', name: 'Qwen3.8 Max' },
  { id: 'qwen3.8-flash', name: 'Qwen3.8 Flash' },
]
