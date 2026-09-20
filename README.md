<p align="center">
  <a href="https://roxy.gg">
    <img src="roxy.png" alt="Roxy" width="640" />
  </a>
</p>

<p align="center">
  <strong>Languages:</strong>
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
  <a href="#translations">Contribute in your language</a>
</p>

# Roxy

> An open-source AI coding agent for engineers — built as a cross-platform desktop app.

This project is a fork of [Roxy](https://github.com/roxy-gg/roxy), which is based on [opencode](https://github.com/sst/opencode).

**Download:** [https://roxy.gg](https://roxy.gg)

Roxy is an [Electron](https://www.electronjs.org/) application written in **TypeScript** with a
**React** renderer. It ships a full agent **harness** in the main process: a provider-agnostic
tool-calling loop, per-model tuned system prompts, Plan/Build agents and subagents, disk-backed
context management, and integrations for MCP servers, language-server diagnostics, and `SKILL.md`
skills.

Beyond the agent loop, Roxy integrates a built-in IDE with Git conflict resolution, an interactive
Live2D companion with local GPU-accelerated RVC voice synthesis, a self-hosted Remote Workspace
relay server for mobile control, scheduled autonomous loops, and native terminals.

## Key Features

- **Agent Harness** — Provider-agnostic tool execution loop with Plan (read-only) and Build modes, subagent delegation, automated context compaction, and large tool output disk-spilling.
- **Multi-Provider & Custom Endpoints** — Native support for OpenAI, Copilot (with automatic token refresh), Anthropic, Google Gemini via Vercel AI SDK, local models, and custom image generation endpoints.
- **Integrated IDE & Git Operations** — Built-in code editor with syntax highlighting (Shiki), line diff decorations, visual merge conflict solver, interactive git commit graph, and multi-repo workspace management.
- **Embedded Terminal** — Hardware-accelerated terminal emulator powered by `@xterm/xterm` and `node-pty` supporting persistent shell sessions, standalone popouts, and command history.
- **Live2D Companion & Voice Synthesis** — Interactive Roxy Migurdia Live2D avatar with animated expressions and reactions (headpat/chest interactions), coupled with offline GPU-accelerated RVC (Retrieval-based Voice Conversion) v2 TTS, faster-whisper STT voice input, or Fish Audio cloud voice.
- **Remote Workspace & Mobile Relay** — Pair with a phone or tablet via QR code and PIN without routing code through third parties; defaults to `https://roxy.schvis.com` (configurable via `ROXY_REMOTE_BASE`), with support for a standalone self-hosted Next.js App Router relay server in `remote-server/` (uncommitted / git-ignored).
- **Ecosystem & Extensibility** — Model Context Protocol (MCP) client + Windows MCP, Language Server Protocol (LSP) diagnostics feedback, `SKILL.md` skill runner, persistent Chromium browser automation, and Discord Rich Presence.
- **Full Internationalization** — Complete UI localization across 10 languages (Arabic, German, English, Spanish, French, Hindi, Japanese, Portuguese, Russian, Chinese) synchronized via automated tooling.

## Tech stack

| Layer                 | Choice                                                         |
| --------------------- | -------------------------------------------------------------- |
| Desktop               | Electron 33                                                    |
| Build tool            | electron-vite (Vite 5)                                         |
| UI                    | React 18 + TypeScript                                          |
| Styling               | Tailwind CSS v4                                                |
| Tool-calling & Models | Vercel AI SDK (Anthropic, Google) + native OpenAI, Copilot SSE |
| Terminal              | @xterm/xterm 6 + node-pty                                      |
| Code & Diff Viewers   | Shiki + diff                                                   |
| Integrations          | Model Context Protocol (MCP) SDK, LSP, Discord RPC             |
| Voice Engine          | Local RVC v2 (PyTorch/CUDA) + faster-whisper + Fish Audio API  |
| Companion             | Live2D Cubism Core                                             |
| Storage               | better-sqlite3                                                 |
| Packaging             | electron-builder                                               |
| Localization          | i18next + react-i18next (10 locales)                           |
| Formatting            | Prettier                                                       |

## Project structure

```
roxy/
├── build/                  # Packaging resources (icons, entitlements)
├── remote-server/          # Standalone Next.js relay & mobile client (git-ignored, not in repo commits)
├── resources/              # Static assets bundled with the app
│   ├── models/live2d/      # Live2D Cubism companion avatar assets
│   ├── prompts/            # Tuned per-model + agent system prompts (inlined via ?raw)
│   └── voicelines/         # Interactive companion audio voice triggers
├── RoxyMigurdia/           # RVC voice model checkpoints (.pth) and feature indices (.index)
├── script/                 # Setup scripts, TTS/STT daemons, i18n translation & packaging
│   ├── rvc_tts_server.py   # Local GPU RVC TTS inference daemon (port 5050)
│   ├── setup_tts_env.py    # Automated Python environment and CUDA dependency installer
│   ├── transcribe.py       # faster-whisper STT voice recognition runner
│   ├── i18n-sync.mjs       # Catalog synchronizer for default.json
│   └── i18n-translate.mjs  # Machine translation runner via OpenRouter
├── src/
│   ├── main/               # Electron main process (Node.js)
│   │   ├── index.ts        # App lifecycle, window creation, service startup
│   │   ├── harness/        # Agent loop: agent.ts (turn loop, tool schemas), tools.ts (dispatch)
│   │   ├── services/       # llm.ts, aisdk.ts, mcp.ts, lsp.ts, tts.ts, stt.ts, browser.ts, remote.ts, …
│   │   ├── db/             # better-sqlite3 store: schema, migrations, repository layer
│   │   └── ipc/            # ipcMain handlers wiring the renderer to harness and services
│   ├── preload/            # Secure bridge between main and renderer (window.api)
│   ├── renderer/           # React app (Chromium): routes, components, store
│   │   └── src/
│   │       ├── components/ # ChatView, FileEditor, GitActionsView, Live2dCanvas, McpServers, …
│   │       └── locales/    # Source of truth default.json and 10 language catalogs
│   └── shared/             # Pure, cross-process modules: tools, agents, prompt/prompt-text,
│                           #   providers, context, tool-history, mcp, lsp, skills, types
├── test/                   # Smoke test suites (Electron app, shared Node, store, i18n, canvas)
├── electron.vite.config.ts # Main / preload / renderer build config
└── electron-builder.yml    # Distribution packaging config
```

## Getting started

### Prerequisites

- **Node.js** >= 20
- **Python** >= 3.10 (optional, required for local RVC voice synthesis and local STT)
- **NVIDIA GPU with CUDA** (recommended for local voice conversion; CPU mode supported)

### Install & Run Desktop App

```bash
# Install dependencies
npm install

# Run in development (hot reload)
npm run dev
```

### Voice Engine Setup (Optional)

Roxy can speak responses using a local RVC voice conversion model:

```bash
# 1. Install Python audio dependencies, PyTorch CUDA, and RVC
python script/setup_tts_env.py

# 2. Start the local RVC TTS daemon (listens on http://127.0.0.1:5050)
npm run tts:server
```

You can also enable **Fish Audio API** under Settings for cloud-based voice synthesis without local GPU requirements.

## Useful scripts

| Script                   | Description                                                               |
| ------------------------ | ------------------------------------------------------------------------- |
| `npm run dev`            | Start desktop application with hot reload                                 |
| `npm run build`          | Type-check and compile main, preload, and renderer                        |
| `npm run typecheck`      | Type-check both Node (`tsconfig.node.json`) and Web (`tsconfig.web.json`) |
| `npm run start`          | Preview production build                                                  |
| `npm run tts:server`     | Start the local RVC TTS Python voice server                               |
| `npm run smoke`          | Run full smoke suite (shared, i18n, store, multirepo, app)                |
| `npm run smoke:shared`   | Run fast Node-only shared module smoke tests                              |
| `npm run smoke:store`    | Verify database schema and migration guards                               |
| `npm run smoke:i18n`     | Verify translation catalogs against `default.json` schema                 |
| `npm run i18n`           | Report translation completion status across all 10 locales                |
| `npm run i18n:sync`      | Synchronize translation catalog keys with `default.json`                  |
| `npm run i18n:translate` | Translate missing keys using OpenRouter                                   |
| `npm run format`         | Format code with Prettier                                                 |
| `npm run format:check`   | Check code formatting                                                     |
| `npm run build:win`      | Build Windows executable / installer                                      |
| `npm run build:mac`      | Build macOS application bundle                                            |
| `npm run build:linux`    | Build Linux distribution packages (AppImage, deb)                         |

## Architecture notes

- **Context isolation is enabled** and `nodeIntegration` is off. The renderer talks to the main
  process only through the typed `window.api` bridge defined in [`src/preload`](src/preload/index.ts).
- IPC handlers live in [`src/main/ipc`](src/main/ipc/index.ts). Add a new renderer-facing capability
  by registering an `ipcMain.handle(...)` there and exposing a matching method in the preload bridge.

### Agent harness

The main process runs a single provider-agnostic agent loop; the renderer only streams events.

- **Tool loop** — [`src/main/harness/agent.ts`](src/main/harness/agent.ts) owns the turn loop, the
  tool JSON-schemas (`BASE_SCHEMAS`), context trimming, and subagent dispatch.
  [`tools.ts`](src/main/harness/tools.ts) is the authoritative `runTool` dispatcher. The user-facing
  catalog in [`src/shared/tools.ts`](src/shared/tools.ts) mirrors it (the "Skills & Tools" page) and
  is guarded against drift by the shared smoke suite.
- **Providers** — the hand-rolled OpenAI/Copilot SSE path (with Copilot's short-lived-token refresh)
  lives in [`services/llm.ts`](src/main/services/llm.ts); Anthropic + Google route through the Vercel
  AI SDK in [`services/aisdk.ts`](src/main/services/aisdk.ts) so every family gets tool-calling.
- **Prompts & agents** — tuned per-model prompts are selected in
  [`src/shared/prompt.ts`](src/shared/prompt.ts) and inlined from `resources/prompts/*.txt` via `?raw`
  in [`prompt-text.ts`](src/shared/prompt-text.ts). Plan/Build agents + subagents are defined in
  [`src/shared/agents.ts`](src/shared/agents.ts); an agent's `tools` allowlist and `promptFile` are
  what make Plan genuinely read-only.
- **Context management** — overflow is measured against the model's real limit
  ([`src/shared/context.ts`](src/shared/context.ts)); large tool outputs spill to disk with a preview
  pointer ([`services/tool-output-store.ts`](src/main/services/tool-output-store.ts)); older turns are
  summarized by [`services/compaction.ts`](src/main/services/compaction.ts).
- **Ecosystem** — external tool servers via the MCP client
  ([`services/mcp.ts`](src/main/services/mcp.ts)), language-server diagnostics fed back after edits
  ([`services/lsp.ts`](src/main/services/lsp.ts)), and on-demand `SKILL.md` skills
  ([`services/skills.ts`](src/main/services/skills.ts)). Roxy's persistent browser toolset
  ([`services/browser.ts`](src/main/services/browser.ts)) and recurring scheduled loops
  ([`services/loops.ts`](src/main/services/loops.ts)) run through the same loop.

### Integrated IDE & Git Workflow

- **File Editor & Tree** — [`src/renderer/src/components/FileEditor.tsx`](src/renderer/src/components/FileEditor.tsx)
  provides an in-app editor with syntax highlighting powered by Shiki, active file tabs, and context attachment.
- **Git Actions & Conflict Solver** — [`src/renderer/src/components/GitActionsView.tsx`](src/renderer/src/components/GitActionsView.tsx)
  and [`MergeConflictSolver.tsx`](src/renderer/src/components/MergeConflictSolver.tsx) render visual branch history,
  staged changes, diff inspections, and 3-way merge conflict resolution.
- **Terminal Emulator** — Built on `@xterm/xterm` and `node-pty` with shell sessions managed in
  [`src/main/services/shell-session.ts`](src/main/services/shell-session.ts) and
  [`src/renderer/src/components/TerminalView.tsx`](src/renderer/src/components/TerminalView.tsx).

### Live2D Companion & Voice Synthesis

- **Live2D Avatar** — Rendered via Cubism Core in [`Live2dCanvas.tsx`](src/renderer/src/components/Live2dCanvas.tsx)
  and [`VtuberStandalone.tsx`](src/renderer/src/components/VtuberStandalone.tsx) with interactive physics,
  expression triggers, and audio lip-sync.
- **RVC v2 Inference** — Local Python daemon [`script/rvc_tts_server.py`](script/rvc_tts_server.py)
  combines edge-tts generation with local GPU pitch/timbre conversion using checkpoints in `RoxyMigurdia/`.
- **Speech-to-Text** — [`src/main/services/stt.ts`](src/main/services/stt.ts) captures voice prompts and
  transcribes locally using faster-whisper ([`script/transcribe.py`](script/transcribe.py)).

### Remote Workspace

Take a running session to your phone. **Remote Workspace** (bottom-left **CUSTOMIZE** group in the
sidebar) mints a room, shows a QR code + safe URL + PIN, and keeps the desktop as the authoritative host
while a phone drives it as a thin client — **your code and files never leave the machine**; only the chat
transcript and streamed agent events are relayed.

- **Host service** — [`main/services/remote.ts`](src/main/services/remote.ts) mints the session on the relay
  (configured via `ROXY_REMOTE_BASE`, defaulting to `https://roxy.schvis.com`), holds the **host token**, and maintains
  a persistent WebSocket. On a guest `hello` it sends a transcript snapshot; on a guest `prompt` it runs the turn
  locally, streaming every `LlmEvent` to the phone and local renderer simultaneously.
- **One loop, no drift** — Local `llm:start` IPC calls and remote prompts both execute through
  [`main/services/session-turn.ts`](src/main/services/session-turn.ts) `runSessionTurn`.
- **Security** — Zero-login authentication: a short-lived HMAC guest token passes through the URL fragment
  and the phone must provide the 6-digit **PIN** displayed on desktop. Rooms are automatically revoked on stop,
  after repeated failed PIN attempts, or upon desktop disconnection.

<a id="translations"></a>

## Translations

Roxy ships in English, 简体中文, हिन्दी, Español, العربية, Français, Português, Русский,
Deutsch, and 日本語. Native speakers can help make the interface clearer and more natural.
Issues and pull-request descriptions are welcome in any of these languages.

- English source strings live in
  [`src/renderer/src/locales/default.json`](src/renderer/src/locales/default.json).
- Translation catalogs live in
  [`src/renderer/src/locales`](src/renderer/src/locales).
- See the [localization guide](AGENTS.md#user-facing-strings-live-in-defaultjson) before editing
  UI copy or adding a language.
- Run `npm run i18n` to validate catalog structure, placeholders, and inline markup.

## License

[MIT](LICENSE) © Roxy.

This project is a fork of [Roxy](https://github.com/roxy-gg/roxy) that is based on [opencode](https://github.com/sst/opencode) (also MIT), and retains
their copyright alongside this project's own. See [LICENSE](LICENSE) and
[`resources/prompts/ATTRIBUTION.txt`](resources/prompts/ATTRIBUTION.txt) for
details.
