# dsh-qwen-subscription

[English](README.md) | Русский

Ваша **подписка qwen.ai** внутри DeepSeek Harness — без API-ключа и отдельного биллинга.
Добавляет провайдера `qwen` с моделями `qwen4-max`, `qwen3.8-max` и `qwen3.8-flash`
(контекст 1M, текст и картинки).

npm: [dsh-llm-qwen-subscription](https://www.npmjs.com/package/dsh-llm-qwen-subscription)

## Установка

```sh
dsh plugin --profile desktop add dsh-llm-qwen-subscription
```

Для браузерного профиля замените `--profile desktop` на `--profile web`, затем **перезапустите**
DeepSeek Harness: профиль собирается при старте. Пакет ставится из npm. Чтобы поставить напрямую
из репозитория, укажите `github:AppsGanin/dsh-qwen-subscription` вместо имени пакета.

Обновление позже:

```sh
dsh plugin --profile desktop update dsh-llm-qwen-subscription
```

На macOS `dsh` лежит по пути
`/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh` — вызывайте по полному пути
или добавьте этот каталог в `PATH`.

## Вход

Settings → **Qwen** → «Войти». Появится код; откройте страницу подтверждения, подтвердите — аккаунт
появится в той же карточке.

## Как пользоваться

- Выберите модель `qwen` в списке моделей: `qwen3.8-flash` для быстрых шагов, `qwen4-max` для сложных.
- Уровень рассуждений (`off` / `low` / `medium` / `high`) выбирается рядом с названием модели.
- Картинки прикрепляются как обычно; текст, рассуждения, вызовы инструментов и расход токенов идут стримом.
- Карточка настроек говорит на языке приложения (Settings → General → Language); встроены английский и русский.

## Несколько подписок

«Добавить аккаунт» подключает второй аккаунт qwen.ai. Запрос начинается с основного аккаунта и уходит на
следующий, когда кредиты кончились или провайдер ограничил частоту, поэтому ход не срывается, пока есть
место на другой подписке. Когда квота исчерпана, карточка показывает дату сброса.

## Если что-то не так

| Что видно | Что делать |
|---|---|
| В списке моделей нет `qwen` | Перезапустите приложение после установки плагина |
| «Qwen subscription is not signed in» | Settings → Qwen → «Войти» |
| «sign-in ... is no longer valid» | Войдите заново в Settings → Qwen |
| «Quota exhausted until …» | Добавьте второй аккаунт или дождитесь даты из плашки |

## Лицензия

MIT — см. [LICENSE](LICENSE).
