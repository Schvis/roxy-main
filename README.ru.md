<p align="center">
  <a href="https://roxy.gg">
    <img src="roxy.png" alt="Roxy" width="640" />
  </a>
</p>

<p align="center">
  <strong>Языки:</strong>
  <a href="README.md">English</a> ·
  <a href="README.zh.md">简体中文</a> ·
  <a href="README.hi.md">हिन्दी</a> ·
  <a href="README.es.md">Español</a> ·
  <a href="README.ar.md">العربية</a> ·
  <a href="README.fr.md">Français</a> ·
  <a href="README.pt.md">Português</a> ·
  <a href="README.ru.md">Русский</a> ·
  <a href="README.de.md">Deutsch</a> ·
  <a href="README.ja.md">日本語</a>
  <br />
  <a href="#translations">Помочь на своём языке</a>
</p>

# Roxy

> Открытый ИИ-агент для программирования, созданный для инженеров как кроссплатформенное настольное приложение.

**Скачать:** [https://roxy.gg](https://roxy.gg)

Roxy — приложение на [Electron](https://www.electronjs.org/), написанное на **TypeScript** с интерфейсом на **React**. Основной процесс содержит полноценную агентную систему: независимый от провайдера цикл инструментов, инструкции для разных моделей, агенты Plan/Build и субагенты, управление контекстом на диске, интеграции с MCP-серверами, диагностику языковых серверов и навыки `SKILL.md`.

## Технологии

| Уровень               | Технология                         |
| --------------------- | ---------------------------------- |
| Настольное приложение | Electron 33                        |
| Сборка                | electron-vite (Vite 5)             |
| Интерфейс             | React 18 + TypeScript              |
| Стили                 | Tailwind CSS v4                    |
| Вызов инструментов    | Vercel AI SDK (Anthropic + Google) |
| Интеграции            | Model Context Protocol SDK         |
| Хранилище             | better-sqlite3                     |
| Упаковка              | electron-builder                   |
| Форматирование        | Prettier                           |

## Структура проекта

```text
roxy/
├── build/                  # Ресурсы упаковки: значки и разрешения
├── resources/              # Статические ресурсы приложения
│   └── prompts/            # Инструкции для моделей и агентов
├── src/
│   ├── main/               # Основной процесс Electron (Node.js)
│   │   ├── index.ts        # Жизненный цикл, окна и запуск служб
│   │   ├── harness/        # Цикл агента и выполнение инструментов
│   │   ├── services/       # LLM, MCP, LSP, навыки, браузер и циклы
│   │   ├── db/             # Схема, миграции и репозиторий better-sqlite3
│   │   └── ipc/            # IPC-связь интерфейса и служб
│   ├── preload/            # Безопасный мост window.api
│   ├── renderer/           # Приложение React (Chromium)
│   └── shared/             # Общие модули для разных процессов
├── test/                   # Дымовые и проверочные тесты
├── electron.vite.config.ts # Конфигурация сборки
└── electron-builder.yml    # Конфигурация дистрибутива
```

## Начало работы

```bash
# Установить зависимости
npm install

# Запустить режим разработки с горячей перезагрузкой
npm run dev
```

## Полезные скрипты

| Скрипт                | Описание                                         |
| --------------------- | ------------------------------------------------ |
| `npm run dev`         | Запускает приложение с горячей перезагрузкой     |
| `npm run build`       | Проверяет типы и создаёт производственную сборку |
| `npm run typecheck`   | Проверяет типы main, preload и renderer          |
| `npm run smoke`       | Запускает общие тесты и тесты Electron           |
| `npm run format`      | Форматирует репозиторий с помощью Prettier       |
| `npm run build:win`   | Создаёт установщик Windows                       |
| `npm run build:mac`   | Создаёт приложение macOS                         |
| `npm run build:linux` | Создаёт пакеты Linux (AppImage и deb)            |

## Архитектура

- Изоляция контекста включена, а `nodeIntegration` отключена. Интерфейс взаимодействует с основным процессом только через типизированный мост `window.api`, определённый в [`src/preload`](src/preload/index.ts).
- Обработчики IPC находятся в [`src/main/ipc`](src/main/ipc/index.ts). Новые функции интерфейса должны регистрировать `ipcMain.handle(...)` и предоставлять соответствующий метод через preload-мост.

### Агентная система

Основной процесс выполняет единый независимый от провайдера цикл агента; интерфейс лишь принимает поток событий.

- **Цикл инструментов:** [`src/main/harness/agent.ts`](src/main/harness/agent.ts) управляет ходами, схемами `BASE_SCHEMAS`, сокращением контекста и субагентами. [`tools.ts`](src/main/harness/tools.ts) содержит основной диспетчер `runTool`.
- **Провайдеры:** SSE-интеграция OpenAI/Copilot находится в [`services/llm.ts`](src/main/services/llm.ts). Anthropic и Google используют Vercel AI SDK через [`services/aisdk.ts`](src/main/services/aisdk.ts).
- **Инструкции и агенты:** [`src/shared/prompt.ts`](src/shared/prompt.ts) выбирает инструкции для каждой модели. Агенты Plan/Build и субагенты определены в [`src/shared/agents.ts`](src/shared/agents.ts).
- **Управление контекстом:** [`src/shared/context.ts`](src/shared/context.ts) учитывает реальный лимит каждой модели; крупные результаты сохраняются на диск, а старые ходы сжимаются.
- **Экосистема:** MCP, диагностика LSP, навыки `SKILL.md`, постоянный браузер и периодические циклы используют одну агентную систему.

### Удалённое рабочее пространство

Продолжайте активную сессию с телефона. **Remote Workspace** создаёт комнату на roxy.gg, показывает QR-код, безопасный URL и PIN, оставляя компьютер главным хостом. **Код и файлы никогда не покидают компьютер**; передаются только переписка и события агента.

- [`main/services/remote.ts`](src/main/services/remote.ts) создаёт сессию через `POST https://roxy.gg/api/remote/sessions`, хранит токен хоста и поддерживает соединение WebSocket.
- Локальные и удалённые запросы используют `runSessionTurn` из [`main/services/session-turn.ts`](src/main/services/session-turn.ts), поэтому ведут себя одинаково.
- IPC API включает `remote:start`, `remote:stop`, `remote:status` и события `remote:state`. Диалог QR-кода находится в [`renderer/src/components/RemoteWorkspaceDialog.tsx`](src/renderer/src/components/RemoteWorkspaceDialog.tsx).
- Комната отзывается после остановки доступа, слишком большого числа неверных PIN, истечения срока или вскоре после отключения компьютера. Протокол описан в [README roxy.gg](../roxy.gg/README.md#remote-workspace).

<a id="translations"></a>

## Переводы

Roxy доступен на English, 简体中文, हिन्दी, Español, العربية, Français, Português, Русский, Deutsch и 日本語. Носители языка могут помочь сделать интерфейс понятнее и естественнее. Issues и описания pull requests принимаются на любом из этих языков.

- Английские исходные строки находятся в [`src/renderer/src/locales/default.json`](src/renderer/src/locales/default.json).
- Каталоги переводов находятся в [`src/renderer/src/locales`](src/renderer/src/locales).
- Перед изменением текста интерфейса или добавлением языка прочтите [руководство по локализации](AGENTS.md#user-facing-strings-live-in-defaultjson).
- Выполните `npm run i18n`, чтобы проверить структуру, заполнители и встроенную разметку.

## Лицензия

[MIT](LICENSE) © Roxy.

Roxy является форком [opencode](https://github.com/sst/opencode), также выпущенного под лицензией MIT, и сохраняет его уведомления об авторских правах вместе с собственными. Подробности приведены в [LICENSE](LICENSE) и [`resources/prompts/ATTRIBUTION.txt`](resources/prompts/ATTRIBUTION.txt).
