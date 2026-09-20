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

Этот проект является форком [Roxy](https://github.com/roxy-gg/roxy), основанного на [opencode](https://github.com/sst/opencode).

**Скачать:** [https://roxy.gg](https://roxy.gg)

Roxy — приложение на [Electron](https://www.electronjs.org/), написанное на **TypeScript** с интерфейсом на **React**. Основной процесс содержит полноценную среду агента (**harness**): независимый от провайдера цикл вызова инструментов, настроенные под каждую модель системные промпты, агенты Plan/Build и субагенты, дисковое управление контекстом, а также интеграции для MCP-серверов, диагностики языковых серверов и навыков `SKILL.md`.

Помимо цикла агента, Roxy включает встроенную IDE с разрешением конфликтов Git, интерактивного Live2D-компаньона с локальным синтезом речи RVC с аппаратным ускорением на GPU, автономный релей-сервер Remote Workspace для управления со смартфона, запланированные автономные циклы и нативные терминалы.

## Ключевые возможности

- **Среда агента (Harness)** — Независимый от провайдера цикл выполнения инструментов с режимами Plan (только для чтения) и Build, делегирование субагентам, автоматическое сжатие контекста и сохранение крупных выводов инструментов на диск.
- **Поддержка множества провайдеров и кастомных эндпоинтов** — Нативная поддержка OpenAI, Copilot (с автоматическим обновлением токенов), Anthropic, Google Gemini через Vercel AI SDK, локальных моделей и кастомных эндпоинтов генерации изображений.
- **Встроенная IDE и операции Git** — Встроенный редактор кода с подсветкой синтаксиса (Shiki), построчной индикацией различий (diff), визуальным разрешением конфликтов слияния, интерактивным графом коммитов Git и управлением многорепозиторными рабочими пространствами.
- **Встроенный терминал** — Аппаратно-ускоренный эмулятор терминала на базе `@xterm/xterm` и `node-pty` с поддержкой постоянных сессий оболочки, отдельных всплывающих окон и истории команд.
- **Live2D-компаньон и синтез речи** — Интерактивный аватар Live2D Рокси Мигурдия с анимированной мимикой и реакциями (поглаживание по голове / взаимодействие с грудью), дополненный офлайн-TTS RVC (Retrieval-based Voice Conversion) v2 с GPU-ускорением, голосовым вводом STT faster-whisper или облачным голосом Fish Audio.
- **Удалённое рабочее пространство и мобильный релей** — Сопряжение со смартфоном или планшетом по QR-коду и PIN-коду без передачи кода через сторонние сервисы; по умолчанию `https://roxy.schvis.com` (настраивается через `ROXY_REMOTE_BASE`), с поддержкой автономного локального релей-сервера на базе Next.js App Router в `remote-server/` (не коммитится / игнорируется git).
- **Экосистема и расширяемость** — Клиент Model Context Protocol (MCP) + Windows MCP, обратная связь по диагностике Language Server Protocol (LSP), исполнитель навыков `SKILL.md`, постоянная автоматизация браузера Chromium и Discord Rich Presence.
- **Полная интернационализация** — Полная локализация интерфейса на 10 языков (арабский, немецкий, английский, испанский, французский, хинди, японский, португальский, русский, китайский), синхронизируемая с помощью автоматизированных инструментов.

## Технологический стек

| Слой                  | Решение                                                           |
| --------------------- | ----------------------------------------------------------------- |
| Настольное приложение | Electron 33                                                       |
| Сборщик               | electron-vite (Vite 5)                                            |
| Интерфейс             | React 18 + TypeScript                                             |
| Стилизация            | Tailwind CSS v4                                                   |
| Модели и инструменты  | Vercel AI SDK (Anthropic, Google) + нативные OpenAI, Copilot SSE  |
| Терминал              | @xterm/xterm 6 + node-pty                                         |
| Просмотр кода и diff  | Shiki + diff                                                      |
| Интеграции            | Model Context Protocol (MCP) SDK, LSP, Discord RPC                |
| Голосовой движок      | Локальный RVC v2 (PyTorch/CUDA) + faster-whisper + Fish Audio API |
| Компаньон             | Live2D Cubism Core                                                |
| Хранилище             | better-sqlite3                                                    |
| Упаковка              | electron-builder                                                  |
| Локализация           | i18next + react-i18next (10 языков)                               |
| Форматирование        | Prettier                                                          |

## Структура проекта

```
roxy/
├── build/                  # Ресурсы упаковки (значки, права/entitlements)
├── remote-server/          # Автономный Next.js релей и мобильный клиент (игнорируется git, вне коммитов)
├── resources/              # Статические ресурсы, поставляемые с приложением
│   ├── models/live2d/      # Ресурсы аватара компаньона Live2D Cubism
│   ├── prompts/            # Системные промпты моделей и агентов (встраиваются через ?raw)
│   └── voicelines/         # Аудио-триггеры реплик интерактивного компаньона
├── RoxyMigurdia/           # Чекпоинты голосовой модели RVC (.pth) и индексы признаков (.index)
├── script/                 # Скрипты настройки, демоны TTS/STT, перевод i18n и упаковка
│   ├── rvc_tts_server.py   # Демон локального вывода GPU RVC TTS (порт 5050)
│   ├── setup_tts_env.py    # Автоматический установщик окружения Python и зависимостей CUDA
│   ├── transcribe.py       # Исполнитель распознавания речи STT faster-whisper
│   ├── i18n-sync.mjs       # Синхронизатор каталогов для default.json
│   └── i18n-translate.mjs  # Запуск машинного перевода через OpenRouter
├── src/
│   ├── main/               # Основной процесс Electron (Node.js)
│   │   ├── index.ts        # Жизненный цикл приложения, создание окон, запуск сервисов
│   │   ├── harness/        # Цикл агента: agent.ts (цикл ходов, схемы инструментов), tools.ts (диспетчеризация)
│   │   ├── services/       # llm.ts, aisdk.ts, mcp.ts, lsp.ts, tts.ts, stt.ts, browser.ts, remote.ts, …
│   │   ├── db/             # Хранилище better-sqlite3: схема, миграции, слой репозитория
│   │   └── ipc/            # Обработчики ipcMain, связывающие рендерер с harness и сервисами
│   ├── preload/            # Безопасный мост между основным процессом и рендерером (window.api)
│   ├── renderer/           # Приложение React (Chromium): маршруты, компоненты, хранилище
│   │   └── src/
│   │       ├── components/ # ChatView, FileEditor, GitActionsView, Live2dCanvas, McpServers, …
│   │       └── locales/    # Источник правды default.json и каталоги 10 языков
│   └── shared/             # Чистые межпроцессные модули: tools, agents, prompt/prompt-text,
│                           #   providers, context, tool-history, mcp, lsp, skills, types
├── test/                   # Наборы дымовых тестов (приложение Electron, общий Node, store, i18n, canvas)
├── electron.vite.config.ts # Конфигурация сборки main / preload / renderer
└── electron-builder.yml    # Конфигурация дистрибутивной упаковки
```

## Начало работы

### Требования

- **Node.js** >= 20
- **Python** >= 3.10 (опционально, требуется для локального синтеза речи RVC и локального STT)
- **NVIDIA GPU с поддержкой CUDA** (рекомендуется для локального преобразования голоса; поддерживается режим CPU)

### Установка и запуск настольного приложения

```bash
# Установка зависимостей
npm install

# Запуск в режиме разработки (с горячей перезагрузкой)
npm run dev
```

### Настройка голосового движка (опционально)

Roxy может озвучивать ответы с помощью локальной модели преобразования голоса RVC:

```bash
# 1. Установите аудио-зависимости Python, PyTorch CUDA и RVC
python script/setup_tts_env.py

# 2. Запустите локальный демон RVC TTS (прослушивает http://127.0.0.1:5050)
npm run tts:server
```

Вы также можете включить **Fish Audio API** в настройках для облачного синтеза речи без необходимости наличия локального GPU.

## Полезные скрипты

| Скрипт                   | Описание                                                                   |
| ------------------------ | -------------------------------------------------------------------------- |
| `npm run dev`            | Запуск настольного приложения с горячей перезагрузкой                      |
| `npm run build`          | Проверка типов и компиляция main, preload и renderer                       |
| `npm run typecheck`      | Проверка типов для Node (`tsconfig.node.json`) и Web (`tsconfig.web.json`) |
| `npm run start`          | Предпросмотр производственной сборки                                       |
| `npm run tts:server`     | Запуск локального голосового сервера Python RVC TTS                        |
| `npm run smoke`          | Запуск полного набора дымовых тестов (shared, i18n, store, multirepo, app) |
| `npm run smoke:shared`   | Запуск быстрых тестов Node для общих модулей                               |
| `npm run smoke:store`    | Проверка схемы базы данных и проверок миграции                             |
| `npm run smoke:i18n`     | Проверка каталогов перевода на соответствие схеме `default.json`           |
| `npm run i18n`           | Отчёт о статусе перевода для всех 10 языков                                |
| `npm run i18n:sync`      | Синхронизация ключей каталогов перевода с `default.json`                   |
| `npm run i18n:translate` | Перевод недостающих ключей через OpenRouter                                |
| `npm run format`         | Форматирование кода с помощью Prettier                                     |
| `npm run format:check`   | Проверка форматирования кода                                               |
| `npm run build:win`      | Сборка исполняемого файла / установщика для Windows                        |
| `npm run build:mac`      | Сборка пакета приложения для macOS                                         |
| `npm run build:linux`    | Сборка пакетов дистрибутивов Linux (AppImage, deb)                         |

## Архитектура

- **Изоляция контекста включена**, а `nodeIntegration` отключена. Рендерер взаимодействует с основным процессом только через типизированный мост `window.api`, определённый в [`src/preload`](src/preload/index.ts).
- Обработчики IPC находятся в [`src/main/ipc`](src/main/ipc/index.ts). Новые функции рендерера регистрируются через `ipcMain.handle(...)` и предоставляются в preload-мосте.

### Среда агента (Harness)

Основной процесс выполняет единый независимый от провайдера цикл агента; рендерер лишь принимает поток событий.

- **Цикл инструментов** — [`src/main/harness/agent.ts`](src/main/harness/agent.ts) управляет циклом ходов, JSON-схемами инструментов (`BASE_SCHEMAS`), сокращением контекста и распределением субагентов. [`tools.ts`](src/main/harness/tools.ts) — официальный диспетчер `runTool`. Каталог для интерфейса в [`src/shared/tools.ts`](src/shared/tools.ts) дублирует его (страница «Skills & Tools») и защищён от расхождений тестами smoke-сьюта.
- **Провайдеры** — Нативный путь SSE для OpenAI/Copilot (с обновлением краткосрочных токенов Copilot) находится в [`services/llm.ts`](src/main/services/llm.ts); Anthropic и Google направляются через Vercel AI SDK в [`services/aisdk.ts`](src/main/services/aisdk.ts), обеспечивая вызов инструментов для всех семейств моделей.
- **Промпты и агенты** — Промпты для каждой модели выбираются в [`src/shared/prompt.ts`](src/shared/prompt.ts) и встраиваются из `resources/prompts/*.txt` через `?raw` в [`prompt-text.ts`](src/shared/prompt-text.ts). Агенты Plan/Build и субагенты определены в [`src/shared/agents.ts`](src/shared/agents.ts); список разрешённых инструментов `tools` и `promptFile` агента гарантируют строгий режим "только чтение" для Plan.
- **Управление контекстом** — Переполнение контекста измеряется относительно реального лимита модели ([`src/shared/context.ts`](src/shared/context.ts)); крупные выводы инструментов сбрасываются на диск с указателем предпросмотра ([`services/tool-output-store.ts`](src/main/services/tool-output-store.ts)); более старые ходы сжимаются через [`services/compaction.ts`](src/main/services/compaction.ts).
- **Экосистема** — Внешние серверы инструментов через клиент MCP ([`services/mcp.ts`](src/main/services/mcp.ts)), обратная связь по диагностике языковых серверов после правок ([`services/lsp.ts`](src/main/services/lsp.ts)) и навыки по запросу `SKILL.md` ([`services/skills.ts`](src/main/services/skills.ts)). Постоянные инструменты браузера Chromium ([`services/browser.ts`](src/main/services/browser.ts)) и периодические циклы ([`services/loops.ts`](src/main/services/loops.ts)) работают в том же цикле.

### Встроенная IDE и рабочий процесс Git

- **Редактор файлов и дерево** — [`src/renderer/src/components/FileEditor.tsx`](src/renderer/src/components/FileEditor.tsx) предоставляет редактор с подсветкой синтаксиса на базе Shiki, вкладками активных файлов и прикреплением контекста.
- **Действия Git и разрешение конфликтов** — [`src/renderer/src/components/GitActionsView.tsx`](src/renderer/src/components/GitActionsView.tsx) и [`MergeConflictSolver.tsx`](src/renderer/src/components/MergeConflictSolver.tsx) отображают визуальную историю веток, подготовленные изменения, просмотр diff и трёхстороннее разрешение конфликтов слияния.
- **Эмулятор терминала** — Создан на базе `@xterm/xterm` и `node-pty`; сессии оболочки управляются в [`src/main/services/shell-session.ts`](src/main/services/shell-session.ts) и [`src/renderer/src/components/TerminalView.tsx`](src/renderer/src/components/TerminalView.tsx).

### Live2D-компаньон и синтез речи

- **Аватар Live2D** — Отрисовывается через Cubism Core в [`Live2dCanvas.tsx`](src/renderer/src/components/Live2dCanvas.tsx) и [`VtuberStandalone.tsx`](src/renderer/src/components/VtuberStandalone.tsx) с интерактивной физикой, триггерами эмоций и синхронизацией губ со звуком.
- **Вывод RVC v2** — Локальный Python-демон [`script/rvc_tts_server.py`](script/rvc_tts_server.py) объединяет генерацию edge-tts с преобразованием высоты тона и тембра на локальном GPU с помощью чекпоинтов в `RoxyMigurdia/`.
- **Распознавание речи (STT)** — [`src/main/services/stt.ts`](src/main/services/stt.ts) захватывает голосовые подсказки и транскрибирует их локально с помощью faster-whisper ([`script/transcribe.py`](script/transcribe.py)).

### Удалённое рабочее пространство

Продолжайте сессию с вашего телефона. **Remote Workspace** (группа **CUSTOMIZE** внизу слева в боковой панели) создаёт комнату, отображает QR-код + безопасный URL + PIN и оставляет компьютер главным хостом, пока телефон работает как тонкий клиент — **ваш код и файлы никогда не покидают компьютер**; передаются только история чата и события агента.

- **Сервис хоста** — [`main/services/remote.ts`](src/main/services/remote.ts) создаёт сессию на релее (настраивается через `ROXY_REMOTE_BASE`, по умолчанию `https://roxy.schvis.com`), сохраняет **токен хоста** и поддерживает постоянное соединение WebSocket. При получении `hello` от гостя отправляет снимок истории; при получении `prompt` запускает ход локально, одновременно транслируя каждое событие `LlmEvent` на телефон и локальный рендерер.
- **Единый цикл без расхождений** — Локальные вызовы IPC `llm:start` и удалённые промпты выполняются через `runSessionTurn` в [`main/services/session-turn.ts`](src/main/services/session-turn.ts).
- **Безопасность** — Аутентификация без необходимости логина: кратковременный гостевой токен HMAC передаётся во фрагменте URL, а на телефоне требуется ввести 6-значный **PIN**, показанный на компьютере. Комнаты автоматически отзываются при остановке, после нескольких неверных попыток ввода PIN или при отключении компьютера.

<a id="translations"></a>

## Переводы

Roxy доступен на English, 简体中文, हिन्दी, Español, العربية, Français, Português, Русский, Deutsch и 日本語. Носители языка могут помочь сделать интерфейс понятнее и естественнее. Issues и описания pull requests принимаются на любом из этих языков.

- Английские исходные строки находятся в [`src/renderer/src/locales/default.json`](src/renderer/src/locales/default.json).
- Каталоги переводов находятся в [`src/renderer/src/locales`](src/renderer/src/locales).
- Перед изменением текста интерфейса или добавлением языка прочтите [руководство по локализации](AGENTS.md#user-facing-strings-live-in-defaultjson).
- Выполните `npm run i18n`, чтобы проверить структуру каталогов, заполнители и встроенную разметку.

## Лицензия

[MIT](LICENSE) © Roxy.

Этот проект является форком [Roxy](https://github.com/roxy-gg/roxy), который основан на [opencode](https://github.com/sst/opencode) (также лицензия MIT), и сохраняет их авторские права наряду с собственными. Подробности приведены в [LICENSE](LICENSE) и [`resources/prompts/ATTRIBUTION.txt`](resources/prompts/ATTRIBUTION.txt).
