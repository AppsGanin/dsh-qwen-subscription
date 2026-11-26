# dsh-qwen-subscription

[![CI](https://github.com/AppsGanin/dsh-qwen-subscription/actions/workflows/ci.yml/badge.svg)](https://github.com/AppsGanin/dsh-qwen-subscription/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/dsh-llm-qwen-subscription)](https://www.npmjs.com/package/dsh-llm-qwen-subscription)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

[English](README.md) | [Русский](README.ru.md) | 中文

在 DeepSeek Harness 里使用你的 **qwen.ai 订阅** —— 无需 API 密钥，也无需单独计费。
添加提供商 `qwen`，包含 `qwen4-max`、`qwen3.8-max` 和 `qwen3.8-flash`（100 万上下文，支持文本和图像）。

## 环境要求

- DeepSeek Harness `0.2.0` 或更新版本，任意配置文件。设置卡片属于 Web 界面；无界面配置文件用 `dsh-qwen-login` 登录。
- Qwen Code CLI 可以登录的 qwen.ai 订阅。

## 安装

```sh
dsh plugin --profile desktop add dsh-llm-qwen-subscription
```

浏览器配置文件请把 `--profile desktop` 换成 `--profile web`，然后**重启** DeepSeek Harness：
配置文件在启动时组装。包来自 npm。若要从仓库直接安装，把包名换成
`github:AppsGanin/dsh-qwen-subscription`。

以后更新：

```sh
dsh plugin --profile desktop update dsh-llm-qwen-subscription
```

在 macOS 上 `dsh` 位于
`/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh` —— 用完整路径运行，
或把该目录加入 `PATH`。

## 登录

设置 → **Qwen** → **登录**。会显示一个代码；打开确认页面并批准，账号就会出现在同一张卡片中。

## 使用

- 在模型选择器中选择 `qwen` 模型：`qwen3.8-flash` 用于快速回合，`qwen4-max` 用于困难的。
- 推理等级（`off` / `low` / `medium` / `high`）可按模型选择，位于模型名称旁边。
- 图像照常附加；文本、推理、工具调用和 token 用量都会正常流式返回。
- 设置卡片跟随应用语言（设置 → 通用 → 语言）；内置英文、俄文和中文。

## 多个订阅

**添加账号** 会登录第二个 qwen.ai 账号。请求从首选账号开始，当额度用尽或提供商限流时转到下一个，
因此只要另一个订阅还有余量，回合就不会失败。额度用尽时，卡片会显示重置日期。

## 常见问题

| 你看到的 | 该怎么做 |
|---|---|
| 选择器中没有 `qwen` 模型 | 安装插件后重启应用 |
| “Qwen subscription is not signed in” | 设置 → Qwen → 登录 |
| “sign-in ... is no longer valid” | 在 设置 → Qwen 重新登录 |
| “Quota exhausted until …” | 添加第二个账号，或等待所示日期 |

## 链接

- [参与贡献](CONTRIBUTING.md) —— 提交约定与发布流程。
- [安全策略](SECURITY.md) —— 私密漏洞报告渠道。
- [许可证](LICENSE) —— MIT。
