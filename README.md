# dsh-qwen-subscription

[![CI](https://github.com/AppsGanin/dsh-qwen-subscription/actions/workflows/ci.yml/badge.svg)](https://github.com/AppsGanin/dsh-qwen-subscription/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/dsh-llm-qwen-subscription)](https://www.npmjs.com/package/dsh-llm-qwen-subscription)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

English | [Русский](README.ru.md) | [中文](README.zh.md)

Use your **qwen.ai subscription** inside DeepSeek Harness — no API key, no separate billing.
Adds the provider `qwen` with `qwen4-max`, `qwen3.8-max`, and `qwen3.8-flash` (1M context, text and images).

## Requirements

- DeepSeek Harness with the Web GUI, `0.2.0` or newer.
- A qwen.ai subscription that the Qwen Code CLI can sign in to.

## Install

```sh
dsh plugin --profile desktop add dsh-llm-qwen-subscription
```

Use `--profile web` instead of `--profile desktop` for a browser profile, then **restart** DeepSeek
Harness: profiles are composed at start-up. The package comes from npm. To install straight from the
repository, use `github:AppsGanin/dsh-qwen-subscription` instead of the package name.

Later updates:

```sh
dsh plugin --profile desktop update dsh-llm-qwen-subscription
```

On macOS `dsh` lives at
`/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh` — run it by full path or
add that directory to `PATH`.

## Sign in

Settings → **Qwen** → **Sign in**. A code appears; open the confirmation page, approve it, and the
account shows up in the same card.

## Use it

- Pick a `qwen` model in the model picker: `qwen3.8-flash` for quick turns, `qwen4-max` for hard ones.
- The reasoning level (`off` / `low` / `medium` / `high`) is selectable per model, next to the model name.
- Images can be attached as usual; text, reasoning, tool calls and token usage all stream normally.
- The settings card follows the app language (Settings → General → Language); English, Russian and Chinese are built in.

## Several subscriptions

**Add account** signs in a second qwen.ai account. Requests start with the preferred account and
move to the next one when credits run out or the provider rate-limits, so a turn does not fail while
another subscription has room. When a quota is exhausted, the card shows the date it resets.

## Troubleshooting

| What you see | What to do |
|---|---|
| No `qwen` models in the picker | Restart the app after installing the plugin |
| "Qwen subscription is not signed in" | Settings → Qwen → Sign in |
| "sign-in ... is no longer valid" | Sign in again in Settings → Qwen |
| "Quota exhausted until …" | Add a second account, or wait for the date shown |

## Links

- [Contributing](CONTRIBUTING.md) — commit conventions and the release flow.
- [Security policy](SECURITY.md) — private vulnerability reporting.
- [License](LICENSE) — MIT.
