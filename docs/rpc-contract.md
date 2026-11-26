# RPC contract: settings page ⇄ plugin host half

The browser half talks to the Node half over the shared `/api` channel of the host
connection service, with the method prefix `qwen-auth.`. One call is:

```js
const result = await rpc.call('/api', 'qwen-auth.<endpoint>', payload)
// result = { ok: true, value: <payload> } | { ok: false, error: { code, message } }
```

The Node half registers each endpoint as an exact POST route `/api/qwen-auth.<endpoint>`
carrying the standard `client-request` envelope and answering with `server-response`.
A dedicated `/qwen-auth` channel is registered as well through `connection.rpc.handle`;
the `/api` form is the one every DSH build serves to plugins, so the page uses it.

Result shapes:

```json
{ "ok": true, "value": <payload> }
{ "ok": false, "error": { "code": "BAD_REQUEST", "message": "..." } }
```

Endpoint names: `status`, `loginStart`, `loginPoll`, `loginCancel`, `signOut`, `prefer`.

## `status`

Request: `{}`.

Response value:

```json
{
  "provider": "qwen",
  "signedIn": true,
  "authFile": "/Users/you/.dsh/plugins/qwen-subscription/auth.json",
  "endpoint": "https://api.qwen.ai/compatible-mode/v1",
  "accounts": [
    {
      "id": "acc_1a2b",
      "label": "user@example.com",
      "name": "Example User",
      "memberType": "pro",
      "expiresAt": "2026-11-26T11:50:13.094Z",
      "preferred": true,
      "cooldownUntil": null,
      "quota": { "exhausted": true, "memberType": "pro", "resetAt": "2026-12-01T00:00:00.000Z", "observedAt": "2026-11-26T12:00:00.000Z" }
    }
  ],
  "models": [{ "id": "qwen4-max", "name": "Qwen4 Max" }]
}
```

`accounts` is empty when nothing is signed in; `quota` and `cooldownUntil` are `null`
when unknown. `quota.exhausted` means the provider refused a request with a
`subscription_quota` refusal; `resetAt` is the reset instant it named, when it named one.

## `loginStart`

Request: `{ "label"?: string }` (optional account note).

Response value:

```json
{ "flowId": "flow_1a2b", "userCode": "ABCD-1234", "url": "https://chat.qwen.ai/authorize?...", "expiresAt": "2026-11-26T12:10:00.000Z" }
```

The page shows `userCode` and opens `url`; the plugin polls the provider on its own.

## `loginPoll`

Request: `{ "flowId": "flow_1a2b" }`.

Response value, one of:

```json
{ "state": "pending" }
{ "state": "approved", "account": { "id": "acc_1a2b", "label": "user@example.com" } }
```

An expired, refused, or unknown flow answers `{ "ok": false, "error": { "code": "AUTH", "message": "..." } }`.

## `loginCancel`

Request: `{ "flowId": "flow_1a2b" }`. Response value: `{ "canceled": true }`.

## `signOut`

Request: `{ "accountId": "acc_1a2b" }` (omit to sign every account out).

Response value: `{ "signedOut": 1, "revoked": true }`.

## `prefer`

Request: `{ "accountId": "acc_1a2b" }`. Response value: `{ "ok": true }`.

Marks one account preferred; the pool tries it first.
