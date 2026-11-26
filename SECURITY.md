# Security

## Reporting a vulnerability

Please do not open a public issue for a security problem. Use GitHub's private
reporting instead: **Security → Report a vulnerability** on
[AppsGanin/dsh-qwen-subscription](https://github.com/AppsGanin/dsh-qwen-subscription).
That channel is private to the maintainer.

## What this plugin touches

It is an LLM provider: it signs in to a qwen.ai subscription, stores the resulting tokens and
sends chat requests on the user's behalf. Be aware of the following when evaluating it.

- **Credentials.** Tokens live in `~/.dsh/plugins/qwen-subscription/auth.json` with mode `0600`
  inside a `0700` directory. Nothing is sent anywhere except the provider endpoints
  (`auth.qwen.ai`, `api.qwen.ai`) and npm/GitHub for installation.
- **No credential exfiltration.** The plugin has no telemetry, no analytics and no third-party
  requests beyond the provider and the install channel.
- **Permissions.** Like any DeepSeek Harness plugin, it runs with the permissions of the host
  process. Tool approvals do not sandbox plugin code.
- **Attribution.** Provider requests carry the harness product identity in `User-Agent`; no
  prompt text, file paths or user identifiers are added.

## Supported versions

Only the latest published version receives fixes. Releases are automated from `main`.
