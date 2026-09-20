<p align="center">
  <a href="https://roxy.gg">
    <img src="roxy.png" alt="Roxy" width="640" />
  </a>
</p>

<p align="center">
  <strong>Sprachen:</strong>
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
  <a href="#translations">In deiner Sprache mitwirken</a>
</p>

# Roxy

> Ein quelloffener KI-Programmieragent für Entwickler, umgesetzt als plattformübergreifende Desktop-App.

Dieses Projekt ist ein Fork von [Roxy](https://github.com/roxy-gg/roxy), das auf [opencode](https://github.com/sst/opencode) basiert.

**Download:** [https://roxy.gg](https://roxy.gg)

Roxy ist eine mit **TypeScript** entwickelte [Electron](https://www.electronjs.org/)-Anwendung mit einer **React**-Oberfläche. Der Hauptprozess enthält ein vollständiges Agentensystem (**Harness**): eine anbieterunabhängige Werkzeugschleife, modellspezifische Systemanweisungen, Plan/Build-Agenten und Subagenten, festplattenbasierte Kontextverwaltung sowie Integrationen für MCP-Server, Language-Server-Diagnosen und `SKILL.md`-Fähigkeiten.

Über die Agentenschleife hinaus integriert Roxy eine integrierte IDE mit Git-Konfliktlösung, eine interaktive Live2D-Begleiterin mit lokaler, GPU-beschleunigter RVC-Sprachsynthese, einen selbst gehosteten Remote-Workspace-Relay-Server für mobile Steuerung, geplante autonome Schleifen und native Terminals.

## Hauptfunktionen

- **Agenten-Harness** — Anbieterunabhängige Werkzeugausführungsschleife mit Plan- (schreibgeschützt) und Build-Modus, Subagenten-Delegierung, automatischer Kontextkompaktierung und Auslagerung großer Werkzeugausgaben auf die Festplatte.
- **Multi-Provider & benutzerdefinierte Endpunkte** — Native Unterstützung für OpenAI, Copilot (mit automatischer Token-Aktualisierung), Anthropic, Google Gemini über Vercel AI SDK, lokale Modelle und benutzerdefinierte Bildgenerierungs-Endpunkte.
- **Integrierte IDE & Git-Operationen** — Integrierter Code-Editor mit Syntax-Highlighting (Shiki), Zeilen-Diff-Markierungen, visuellem Merge-Konfliktlöser, interaktivem Git-Commit-Graphen und Multi-Repo-Arbeitsbereichsverwaltung.
- **Eingebettetes Terminal** — Hardwarebeschleunigter Terminal-Emulator auf Basis von `@xterm/xterm` und `node-pty` mit Unterstützung für persistente Shell-Sitzungen, separate Popouts und Befehlsverlauf.
- **Live2D-Begleiterin & Sprachsynthese** — Interaktiver Roxy Migurdia Live2D-Avatar mit animierten Gesichtsausdrücken und Reaktionen (Kopftäscheln / Brustinteraktionen), gekoppelt mit lokaler GPU-beschleunigter RVC (Retrieval-based Voice Conversion) v2 TTS, faster-whisper STT-Spracheingabe oder Fish Audio Cloud-Stimme.
- **Remote Workspace & Mobile Relay** — Kopplung mit Smartphone oder Tablet via QR-Code und PIN ohne Routing von Code über Dritte; standardmäßig `https://roxy.schvis.com` (konfigurierbar über `ROXY_REMOTE_BASE`), mit Unterstützung für einen eigenständigen, selbst gehosteten Next.js App Router Relay-Server in `remote-server/` (nicht committet / von git ignoriert).
- **Ökosystem & Erweiterbarkeit** — Model Context Protocol (MCP) Client + Windows MCP, Language Server Protocol (LSP) Diagnose-Feedback, `SKILL.md`-Skill-Runner, persistente Chromium-Browser-Automatisierung und Discord Rich Presence.
- **Vollständige Internationalisierung** — Komplette UI-Lokalisierung für 10 Sprachen (Arabisch, Deutsch, Englisch, Spanisch, Französisch, Hindi, Japanisch, Portugiesisch, Russisch, Chinesisch), synchronisiert über automatisierte Werkzeuge.

## Technologien

| Ebene          | Technologie                                                     |
| -------------- | --------------------------------------------------------------- |
| Desktop        | Electron 33                                                     |
| Build-System   | electron-vite (Vite 5)                                          |
| Oberfläche     | React 18 + TypeScript                                           |
| Styling        | Tailwind CSS v4                                                 |
| Werkzeuge & KI | Vercel AI SDK (Anthropic, Google) + natives OpenAI, Copilot SSE |
| Terminal       | @xterm/xterm 6 + node-pty                                       |
| Code & Diff    | Shiki + diff                                                    |
| Integrationen  | Model Context Protocol (MCP) SDK, LSP, Discord RPC              |
| Sprach-Engine  | Lokales RVC v2 (PyTorch/CUDA) + faster-whisper + Fish Audio API |
| Begleiterin    | Live2D Cubism Core                                              |
| Datenspeicher  | better-sqlite3                                                  |
| Paketierung    | electron-builder                                                |
| Lokalisierung  | i18next + react-i18next (10 Sprachen)                           |
| Formatierung   | Prettier                                                        |

## Projektstruktur

```
roxy/
├── build/                  # Paketierungsressourcen (Icons, Entitlements)
├── remote-server/          # Eigenständiges Next.js Relay & mobiler Client (git-ignoriert, nicht im Repo)
├── resources/              # Statische Ressourcen der App
│   ├── models/live2d/      # Assets des Live2D Cubism Begleiter-Avatars
│   ├── prompts/            # Modellspezifische System-Prompts (eingebunden via ?raw)
│   └── voicelines/         # Audio-Trigger für interaktive Begleiter-Stimme
├── RoxyMigurdia/           # RVC-Sprachmodell-Checkpoints (.pth) und Feature-Indizes (.index)
├── script/                 # Setup-Skripte, TTS/STT-Dienste, i18n-Übersetzung & Paketierung
│   ├── rvc_tts_server.py   # Lokaler GPU RVC TTS Inferenz-Dienst (Port 5050)
│   ├── setup_tts_env.py    # Automatischer Python-Umgebungs- und CUDA-Installer
│   ├── transcribe.py       # faster-whisper STT Spracherkennungs-Runner
│   ├── i18n-sync.mjs       # Katalog-Synchronisierer für default.json
│   └── i18n-translate.mjs  # Maschineller Übersetzungs-Runner über OpenRouter
├── src/
│   ├── main/               # Electron-Hauptprozess (Node.js)
│   │   ├── index.ts        # App-Lebenszyklus, Fenstererstellung, Dienststart
│   │   ├── harness/        # Agentenschleife: agent.ts (Turn-Loop, Schemas), tools.ts (Dispatch)
│   │   ├── services/       # llm.ts, aisdk.ts, mcp.ts, lsp.ts, tts.ts, stt.ts, browser.ts, remote.ts, …
│   │   ├── db/             # better-sqlite3 Speicher: Schema, Migrationen, Repository-Schicht
│   │   └── ipc/            # ipcMain-Handler zur Verbindung von Renderer mit Harness und Diensten
│   ├── preload/            # Sichere Brücke zwischen Main und Renderer (window.api)
│   ├── renderer/           # React-App (Chromium): Routen, Komponenten, Store
│   │   └── src/
│   │       ├── components/ # ChatView, FileEditor, GitActionsView, Live2dCanvas, McpServers, …
│   │       └── locales/    # Source of Truth default.json und 10 Sprachkataloge
│   └── shared/             # Reine, prozessübergreifende Module: tools, agents, prompt/prompt-text,
│                           #   providers, context, tool-history, mcp, lsp, skills, types
├── test/                   # Smoke-Test-Suiten (Electron-App, Shared Node, Store, i18n, Canvas)
├── electron.vite.config.ts # Build-Konfiguration für Main / Preload / Renderer
└── electron-builder.yml    # Konfiguration für Distributionspakete
```

## Erste Schritte

### Voraussetzungen

- **Node.js** >= 20
- **Python** >= 3.10 (optional, erforderlich für lokale RVC-Sprachsynthese und lokales STT)
- **NVIDIA-GPU mit CUDA** (empfohlen für lokale Sprachkonvertierung; CPU-Modus unterstützt)

### Desktop-App installieren & ausführen

```bash
# Abhängigkeiten installieren
npm install

# Im Entwicklungsmodus starten (Hot Reload)
npm run dev
```

### Sprach-Engine einrichten (Optional)

Roxy kann Antworten mit einem lokalen RVC-Sprachkonvertierungsmodell vorlesen:

```bash
# 1. Python-Audio-Abhängigkeiten, PyTorch CUDA und RVC installieren
python script/setup_tts_env.py

# 2. Lokalen RVC TTS-Dienst starten (lauscht auf http://127.0.0.1:5050)
npm run tts:server
```

Unter Einstellungen kann auch die **Fish Audio API** für Cloud-basierte Sprachsynthese ohne lokale GPU aktiviert werden.

## Nützliche Skripte

| Skript                   | Beschreibung                                                                           |
| ------------------------ | -------------------------------------------------------------------------------------- |
| `npm run dev`            | Desktop-Anwendung mit Hot Reload starten                                               |
| `npm run build`          | Typen prüfen und Main, Preload sowie Renderer kompilieren                              |
| `npm run typecheck`      | Typen sowohl für Node (`tsconfig.node.json`) als auch Web (`tsconfig.web.json`) prüfen |
| `npm run start`          | Vorschau des Produktions-Builds anzeigen                                               |
| `npm run tts:server`     | Lokalen RVC TTS Python-Sprachserver starten                                            |
| `npm run smoke`          | Gesamte Smoke-Suite ausführen (shared, i18n, store, multirepo, app)                    |
| `npm run smoke:shared`   | Schnelle Node-only Smoke-Tests für Shared-Module ausführen                             |
| `npm run smoke:store`    | Datenbankschema und Migrationswächter überprüfen                                       |
| `npm run smoke:i18n`     | Übersetzungskataloge gegen `default.json`-Schema validieren                            |
| `npm run i18n`           | Übersetzungsstatus für alle 10 Sprachen anzeigen                                       |
| `npm run i18n:sync`      | Schlüssel der Übersetzungskataloge mit `default.json` synchronisieren                  |
| `npm run i18n:translate` | Fehlende Schlüssel über OpenRouter übersetzen                                          |
| `npm run format`         | Code mit Prettier formatieren                                                          |
| `npm run format:check`   | Code-Formatierung prüfen                                                               |
| `npm run build:win`      | Windows-Executable / Installer erstellen                                               |
| `npm run build:mac`      | macOS-Anwendungsbundle erstellen                                                       |
| `npm run build:linux`    | Linux-Distributionspakete erstellen (AppImage, deb)                                    |

## Architektur

- **Kontextisolierung ist aktiviert** und `nodeIntegration` ist ausgeschaltet. Der Renderer kommuniziert ausschließlich über die typisierte `window.api`-Brücke in [`src/preload`](src/preload/index.ts) mit dem Hauptprozess.
- IPC-Handler befinden sich in [`src/main/ipc`](src/main/ipc/index.ts). Neue Funktionen für den Renderer werden dort als `ipcMain.handle(...)` registriert und in der Preload-Brücke bereitgestellt.

### Agentensystem

Der Hauptprozess führt eine einzelne, anbieterunabhängige Agentenschleife aus; der Renderer empfängt lediglich gestreamte Ereignisse.

- **Werkzeugschleife** — [`src/main/harness/agent.ts`](src/main/harness/agent.ts) steuert die Turn-Schleife, die Werkzeug-JSON-Schemas (`BASE_SCHEMAS`), Kontextkürzung und Subagenten-Delegierung. [`tools.ts`](src/main/harness/tools.ts) ist der maßgebliche `runTool`-Dispatcher. Der Katalog für die Oberfläche in [`src/shared/tools.ts`](src/shared/tools.ts) spiegelt dies wider (die Seite „Skills & Tools“) und wird durch die Smoke-Suite vor Abweichungen geschützt.
- **Provider** — Der handgeschriebene SSE-Pfad für OpenAI/Copilot (mit Copilots kurzlebigem Token-Refresh) liegt in [`services/llm.ts`](src/main/services/llm.ts); Anthropic und Google laufen über das Vercel AI SDK in [`services/aisdk.ts`](src/main/services/aisdk.ts), sodass jede Modellfamilie Werkzeugaufrufe unterstützt.
- **Prompts & Agenten** — Modellspezifisch abgestimmte Prompts werden in [`src/shared/prompt.ts`](src/shared/prompt.ts) ausgewählt und über `?raw` aus `resources/prompts/*.txt` in [`prompt-text.ts`](src/shared/prompt-text.ts) eingebunden. Plan/Build-Agenten und Subagenten sind in [`src/shared/agents.ts`](src/shared/agents.ts) definiert; die `tools`-Allowlist und `promptFile` eines Agenten stellen sicher, dass Plan strikt schreibgeschützt bleibt.
- **Kontextverwaltung** — Kontextüberlauf wird anhand des tatsächlichen Limits des Modells gemessen ([`src/shared/context.ts`](src/shared/context.ts)); große Werkzeugausgaben werden mit einem Vorschau-Pointer auf die Festplatte ausgelagert ([`services/tool-output-store.ts`](src/main/services/tool-output-store.ts)); ältere Runden werden durch [`services/compaction.ts`](src/main/services/compaction.ts) zusammengefasst.
- **Ökosystem** — Externe Werkzeugserver über den MCP-Client ([`services/mcp.ts`](src/main/services/mcp.ts)), Language-Server-Diagnosen als Feedback nach Bearbeitungen ([`services/lsp.ts`](src/main/services/lsp.ts)) und On-Demand-`SKILL.md`-Fähigkeiten ([`services/skills.ts`](src/main/services/skills.ts)). Roxys persistente Browser-Werkzeuge ([`services/browser.ts`](src/main/services/browser.ts)) und geplante Schleifen ([`services/loops.ts`](src/main/services/loops.ts)) laufen über dieselbe Schleife.

### Integrierte IDE & Git-Workflow

- **Datei-Editor & Baum** — [`src/renderer/src/components/FileEditor.tsx`](src/renderer/src/components/FileEditor.tsx) bietet einen In-App-Editor mit Shiki-Syntax-Highlighting, aktiven Datei-Tabs und Kontext-Anhängen.
- **Git-Aktionen & Konfliktlöser** — [`src/renderer/src/components/GitActionsView.tsx`](src/renderer/src/components/GitActionsView.tsx) und [`MergeConflictSolver.tsx`](src/renderer/src/components/MergeConflictSolver.tsx) zeigen den visuellen Branch-Verlauf, gestagte Änderungen, Diff-Prüfungen und 3-Wege-Merge-Konfliktlösung.
- **Terminal-Emulator** — Basiert auf `@xterm/xterm` und `node-pty`; Shell-Sitzungen werden in [`src/main/services/shell-session.ts`](src/main/services/shell-session.ts) und [`src/renderer/src/components/TerminalView.tsx`](src/renderer/src/components/TerminalView.tsx) verwaltet.

### Live2D-Begleiterin & Sprachsynthese

- **Live2D-Avatar** — Gerendert über Cubism Core in [`Live2dCanvas.tsx`](src/renderer/src/components/Live2dCanvas.tsx) und [`VtuberStandalone.tsx`](src/renderer/src/components/VtuberStandalone.tsx) mit interaktiver Physik, Ausdrucksauslösern und Audio-Lippensynchronisation.
- **RVC v2 Inferenz** — Lokaler Python-Dienst [`script/rvc_tts_server.py`](script/rvc_tts_server.py) kombiniert edge-tts-Generierung mit lokaler GPU-Tonhöhen-/Klangfarbenkonvertierung anhand von Checkpoints in `RoxyMigurdia/`.
- **Spracherkennung (STT)** — [`src/main/services/stt.ts`](src/main/services/stt.ts) erfasst Spracheingaben und transkribiert sie lokal über faster-whisper ([`script/transcribe.py`](script/transcribe.py)).

### Remote-Arbeitsbereich

Nimm eine laufende Sitzung auf dein Smartphone mit. **Remote Workspace** (unten links in der Seitenleiste unter **CUSTOMIZE**) erstellt einen Raum, zeigt QR-Code + sichere URL + PIN und lässt den Desktop als maßgeblichen Host fungieren, während das Smartphone als Thin Client dient — **dein Code und deine Dateien verlassen niemals den Rechner**; nur Chatverlauf und gestreamte Agentenereignisse werden übertragen.

- **Host-Dienst** — [`main/services/remote.ts`](src/main/services/remote.ts) erstellt die Sitzung auf dem Relay (konfiguriert über `ROXY_REMOTE_BASE`, Standard `https://roxy.schvis.com`), hält das **Host-Token** und führt eine persistente WebSocket-Verbindung. Bei Gast-`hello` sendet er einen Verlaufsschnappschuss; bei Gast-`prompt` führt er die Runde lokal aus und streamt jedes `LlmEvent` synchron an Smartphone und lokalen Renderer.
- **Eine Schleife, kein Drift** — Lokale `llm:start`-IPC-Aufrufe und Remote-Prompts laufen beide über [`main/services/session-turn.ts`](src/main/services/session-turn.ts) `runSessionTurn`.
- **Sicherheit** — Authentifizierung ohne Anmeldung: Ein kurzlebiges HMAC-Gast-Token wird im URL-Fragment übertragen und das Smartphone muss die auf dem Desktop angezeigte 6-stellige **PIN** eingeben. Räume werden beim Beenden, nach wiederholten falschen PIN-Eingaben oder bei Desktop-Trennung automatisch widerrufen.

<a id="translations"></a>

## Übersetzungen

Roxy ist in English, 简体中文, हिन्दी, Español, العربية, Français, Português, Русский, Deutsch und 日本語 verfügbar. Muttersprachler können dabei helfen, die Oberfläche klarer und natürlicher zu gestalten. Issues und Pull-Request-Beschreibungen sind in jeder dieser Sprachen willkommen.

- Die englischen Ausgangstexte befinden sich in [`src/renderer/src/locales/default.json`](src/renderer/src/locales/default.json).
- Die Übersetzungskataloge befinden sich in [`src/renderer/src/locales`](src/renderer/src/locales).
- Lies vor Änderungen an Oberflächentexten oder dem Hinzufügen einer Sprache den [Lokalisierungsleitfaden](AGENTS.md#user-facing-strings-live-in-defaultjson).
- Führe `npm run i18n` aus, um Struktur, Platzhalter und eingebettetes Markup zu prüfen.

## Lizenz

[MIT](LICENSE) © Roxy.

Dieses Projekt ist ein Fork von [Roxy](https://github.com/roxy-gg/roxy), das auf [opencode](https://github.com/sst/opencode) basiert (ebenfalls MIT-lizenziert), und behält deren Urheberrechtshinweise neben den eigenen bei. Weitere Informationen stehen in [LICENSE](LICENSE) und [`resources/prompts/ATTRIBUTION.txt`](resources/prompts/ATTRIBUTION.txt).
