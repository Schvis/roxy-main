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

**Download:** [https://roxy.gg](https://roxy.gg)

Roxy ist eine mit **TypeScript** entwickelte [Electron](https://www.electronjs.org/)-Anwendung mit einer **React**-Oberfläche. Der Hauptprozess enthält ein vollständiges Agentensystem: eine anbieterunabhängige Werkzeugschleife, modellspezifische Systemanweisungen, Plan/Build-Agenten und Subagenten, festplattenbasierte Kontextverwaltung sowie Integrationen für MCP-Server, Language-Server-Diagnosen und `SKILL.md`-Fähigkeiten.

## Technologien

| Ebene           | Technologie                        |
| --------------- | ---------------------------------- |
| Desktop         | Electron 33                        |
| Build-System    | electron-vite (Vite 5)             |
| Oberfläche      | React 18 + TypeScript              |
| Styling         | Tailwind CSS v4                    |
| Werkzeugaufrufe | Vercel AI SDK (Anthropic + Google) |
| Integrationen   | Model Context Protocol SDK         |
| Datenspeicher   | better-sqlite3                     |
| Paketierung     | electron-builder                   |
| Formatierung    | Prettier                           |

## Projektstruktur

```text
roxy/
├── build/                  # Paketierungsressourcen: Symbole und Berechtigungen
├── resources/              # Mit der App ausgelieferte statische Ressourcen
│   └── prompts/            # Anweisungen für Modelle und Agenten
├── src/
│   ├── main/               # Electron-Hauptprozess (Node.js)
│   │   ├── index.ts        # App-Lebenszyklus, Fenster und Dienststart
│   │   ├── harness/        # Agentenschleife und Werkzeugausführung
│   │   ├── services/       # LLM, MCP, LSP, Fähigkeiten, Browser und Schleifen
│   │   ├── db/             # Schema, Migrationen und better-sqlite3-Repository
│   │   └── ipc/            # IPC-Verbindung zwischen Oberfläche und Diensten
│   ├── preload/            # Sichere window.api-Brücke
│   ├── renderer/           # React-App (Chromium)
│   └── shared/             # Prozessübergreifend verwendete Module
├── test/                   # Smoke- und Validierungstests
├── electron.vite.config.ts # Build-Konfiguration
└── electron-builder.yml    # Distributionskonfiguration
```

## Erste Schritte

```bash
# Abhängigkeiten installieren
npm install

# Entwicklungsmodus mit Hot Reload starten
npm run dev
```

## Nützliche Skripte

| Skript                | Beschreibung                                       |
| --------------------- | -------------------------------------------------- |
| `npm run dev`         | Startet die App mit Hot Reload                     |
| `npm run build`       | Prüft die Typen und erstellt den Produktions-Build |
| `npm run typecheck`   | Prüft die Typen von main, preload und renderer     |
| `npm run smoke`       | Führt die gemeinsamen und Electron-Tests aus       |
| `npm run format`      | Formatiert das Repository mit Prettier             |
| `npm run build:win`   | Erstellt das Windows-Installationsprogramm         |
| `npm run build:mac`   | Erstellt die macOS-App                             |
| `npm run build:linux` | Erstellt Linux-Pakete (AppImage und deb)           |

## Architektur

- Die Kontextisolierung ist aktiviert und `nodeIntegration` ist deaktiviert. Die Oberfläche kommuniziert ausschließlich über die typisierte `window.api`-Brücke in [`src/preload`](src/preload/index.ts) mit dem Hauptprozess.
- Die IPC-Handler befinden sich in [`src/main/ipc`](src/main/ipc/index.ts). Neue Funktionen für die Oberfläche registrieren dort ein `ipcMain.handle(...)` und stellen die entsprechende Methode über die Preload-Brücke bereit.

### Agentensystem

Der Hauptprozess führt eine einzelne, anbieterunabhängige Agentenschleife aus; die Oberfläche empfängt lediglich die gestreamten Ereignisse.

- **Werkzeugschleife:** [`src/main/harness/agent.ts`](src/main/harness/agent.ts) steuert die Durchläufe, `BASE_SCHEMAS`, die Kontextkürzung und Subagenten. [`tools.ts`](src/main/harness/tools.ts) enthält den maßgeblichen `runTool`-Dispatcher.
- **Anbieter:** Die SSE-Integration für OpenAI/Copilot liegt in [`services/llm.ts`](src/main/services/llm.ts). Anthropic und Google verwenden das Vercel AI SDK über [`services/aisdk.ts`](src/main/services/aisdk.ts).
- **Anweisungen und Agenten:** [`src/shared/prompt.ts`](src/shared/prompt.ts) wählt die modellspezifischen Anweisungen aus. Plan/Build-Agenten und Subagenten sind in [`src/shared/agents.ts`](src/shared/agents.ts) definiert.
- **Kontextverwaltung:** [`src/shared/context.ts`](src/shared/context.ts) berücksichtigt das tatsächliche Limit des jeweiligen Modells; große Ausgaben werden auf die Festplatte ausgelagert und ältere Durchläufe komprimiert.
- **Ökosystem:** MCP, LSP-Diagnosen, `SKILL.md`-Fähigkeiten, der persistente Browser und wiederkehrende Schleifen verwenden dasselbe Agentensystem.

### Remote-Arbeitsbereich

Setze eine aktive Sitzung auf deinem Smartphone fort. **Remote Workspace** erstellt einen Raum auf roxy.gg, zeigt einen QR-Code, eine sichere URL und eine PIN an und lässt den Desktop als maßgeblichen Host arbeiten. **Dein Code und deine Dateien verlassen den Rechner nie**; übertragen werden nur die Unterhaltung und die Ereignisse des Agenten.

- [`main/services/remote.ts`](src/main/services/remote.ts) erstellt die Sitzung mit `POST https://roxy.gg/api/remote/sessions`, verwahrt das Host-Token und hält die WebSocket-Verbindung aufrecht.
- Lokale und entfernte Anfragen verwenden beide `runSessionTurn` in [`main/services/session-turn.ts`](src/main/services/session-turn.ts) und verhalten sich daher identisch.
- Die IPC-API umfasst `remote:start`, `remote:stop`, `remote:status` und `remote:state`-Ereignisse. Der QR-Code-Dialog liegt in [`renderer/src/components/RemoteWorkspaceDialog.tsx`](src/renderer/src/components/RemoteWorkspaceDialog.tsx).
- Der Raum wird beim Beenden der Freigabe, nach zu vielen falschen PINs, beim Ablauf oder kurz nach einer Desktop-Trennung widerrufen. Details stehen im [roxy.gg-README](../roxy.gg/README.md#remote-workspace).

<a id="translations"></a>

## Übersetzungen

Roxy ist in English, 简体中文, हिन्दी, Español, العربية, Français, Português, Русский, Deutsch und 日本語 verfügbar. Muttersprachler können dabei helfen, die Oberfläche klarer und natürlicher zu gestalten. Issues und Pull-Request-Beschreibungen sind in jeder dieser Sprachen willkommen.

- Die englischen Ausgangstexte befinden sich in [`src/renderer/src/locales/default.json`](src/renderer/src/locales/default.json).
- Die Übersetzungskataloge befinden sich in [`src/renderer/src/locales`](src/renderer/src/locales).
- Lies vor Änderungen an Oberflächentexten oder dem Hinzufügen einer Sprache den [Lokalisierungsleitfaden](AGENTS.md#user-facing-strings-live-in-defaultjson).
- Führe `npm run i18n` aus, um Struktur, Platzhalter und eingebettetes Markup zu prüfen.

## Lizenz

[MIT](LICENSE) © Roxy.

Roxy ist ein Fork von [opencode](https://github.com/sst/opencode), das ebenfalls unter der MIT-Lizenz steht, und behält dessen Copyright-Hinweise neben den eigenen bei. Weitere Informationen stehen in [LICENSE](LICENSE) und [`resources/prompts/ATTRIBUTION.txt`](resources/prompts/ATTRIBUTION.txt).
