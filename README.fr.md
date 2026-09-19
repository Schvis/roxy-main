<p align="center">
  <a href="https://roxy.gg">
    <img src="roxy.png" alt="Roxy" width="640" />
  </a>
</p>

<p align="center">
  <strong>Langues :</strong>
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
  <a href="#translations">Contribuer dans votre langue</a>
</p>

# Roxy

> Un agent de programmation IA open source destiné aux ingénieurs, conçu comme une application de bureau multiplateforme.

**Téléchargement :** [https://roxy.gg](https://roxy.gg)

Roxy est une application [Electron](https://www.electronjs.org/) écrite en **TypeScript** avec une interface **React**. Son processus principal contient un système d'agents complet : boucle d'appel d'outils indépendante du fournisseur, instructions adaptées à chaque modèle, agents Plan/Build et sous-agents, gestion du contexte sur disque, serveurs MCP, diagnostics de serveurs de langage et compétences `SKILL.md`.

## Technologies

| Couche         | Choix                              |
| -------------- | ---------------------------------- |
| Bureau         | Electron 33                        |
| Build          | electron-vite (Vite 5)             |
| Interface      | React 18 + TypeScript              |
| Styles         | Tailwind CSS v4                    |
| Appel d'outils | Vercel AI SDK (Anthropic + Google) |
| Intégrations   | Model Context Protocol SDK         |
| Stockage       | better-sqlite3                     |
| Packaging      | electron-builder                   |
| Formatage      | Prettier                           |

## Structure du projet

```text
roxy/
├── build/                  # Ressources de packaging : icônes et autorisations
├── resources/              # Ressources statiques incluses dans l'application
│   └── prompts/            # Instructions adaptées aux modèles et agents
├── src/
│   ├── main/               # Processus principal Electron (Node.js)
│   │   ├── index.ts        # Cycle de vie, fenêtres et démarrage des services
│   │   ├── harness/        # Boucle de l'agent et exécution des outils
│   │   ├── services/       # LLM, MCP, LSP, compétences, navigateur et boucles
│   │   ├── db/             # Schéma, migrations et dépôt better-sqlite3
│   │   └── ipc/            # Liaison IPC entre l'interface et les services
│   ├── preload/            # Pont sécurisé window.api
│   ├── renderer/           # Application React (Chromium)
│   └── shared/             # Modules partagés entre les processus
├── test/                   # Tests de validation et smoke tests
├── electron.vite.config.ts # Configuration du build
└── electron-builder.yml    # Configuration de la distribution
```

## Bien démarrer

```bash
# Installer les dépendances
npm install

# Lancer en développement avec rechargement à chaud
npm run dev
```

## Scripts utiles

| Script                | Description                                         |
| --------------------- | --------------------------------------------------- |
| `npm run dev`         | Lance l'application avec rechargement à chaud       |
| `npm run build`       | Vérifie les types et produit le build de production |
| `npm run typecheck`   | Vérifie les types de main, preload et renderer      |
| `npm run smoke`       | Exécute les tests partagés et Electron              |
| `npm run format`      | Formate le dépôt avec Prettier                      |
| `npm run build:win`   | Crée l'installateur Windows                         |
| `npm run build:mac`   | Crée l'application macOS                            |
| `npm run build:linux` | Crée les paquets Linux (AppImage et deb)            |

## Architecture

- L'isolation du contexte est activée et `nodeIntegration` est désactivé. L'interface communique avec le processus principal uniquement au moyen du pont typé `window.api` défini dans [`src/preload`](src/preload/index.ts).
- Les gestionnaires IPC se trouvent dans [`src/main/ipc`](src/main/ipc/index.ts). Toute nouvelle fonction destinée à l'interface doit enregistrer un `ipcMain.handle(...)` et exposer la méthode correspondante dans le pont de préchargement.

### Système d'agents

Le processus principal exécute une seule boucle d'agent indépendante du fournisseur ; l'interface ne fait que recevoir les événements diffusés.

- **Boucle d'outils :** [`src/main/harness/agent.ts`](src/main/harness/agent.ts) gère les tours, les schémas `BASE_SCHEMAS`, la réduction du contexte et les sous-agents. [`tools.ts`](src/main/harness/tools.ts) contient le répartiteur `runTool`.
- **Fournisseurs :** l'intégration SSE OpenAI/Copilot se trouve dans [`services/llm.ts`](src/main/services/llm.ts). Anthropic et Google utilisent Vercel AI SDK via [`services/aisdk.ts`](src/main/services/aisdk.ts).
- **Instructions et agents :** [`src/shared/prompt.ts`](src/shared/prompt.ts) choisit les instructions selon le modèle. Les agents Plan/Build et les sous-agents sont définis dans [`src/shared/agents.ts`](src/shared/agents.ts).
- **Gestion du contexte :** [`src/shared/context.ts`](src/shared/context.ts) mesure la limite réelle de chaque modèle ; les sorties volumineuses sont stockées sur disque et les anciens tours sont compactés.
- **Écosystème :** MCP, les diagnostics LSP, les compétences `SKILL.md`, le navigateur persistant et les boucles récurrentes utilisent tous le même système d'agents.

### Espace de travail distant

Poursuivez une session active depuis votre téléphone. **Remote Workspace** crée une salle sur roxy.gg, affiche un code QR, une URL sécurisée et un PIN, tout en conservant l'ordinateur comme hôte principal. **Votre code et vos fichiers ne quittent jamais la machine** ; seuls la conversation et les événements de l'agent sont relayés.

- [`main/services/remote.ts`](src/main/services/remote.ts) crée la session avec `POST https://roxy.gg/api/remote/sessions`, conserve le jeton de l'hôte et maintient la connexion WebSocket.
- Les requêtes locales et distantes utilisent toutes `runSessionTurn` dans [`main/services/session-turn.ts`](src/main/services/session-turn.ts), et se comportent donc de la même manière.
- L'API IPC comprend `remote:start`, `remote:stop`, `remote:status` et les événements `remote:state`. La fenêtre du code QR se trouve dans [`renderer/src/components/RemoteWorkspaceDialog.tsx`](src/renderer/src/components/RemoteWorkspaceDialog.tsx).
- La salle est révoquée à l'arrêt du partage, après trop de PIN incorrects, à expiration ou peu après la déconnexion de l'ordinateur. Consultez le protocole dans le [README de roxy.gg](../roxy.gg/README.md#remote-workspace).

<a id="translations"></a>

## Traductions

Roxy est disponible en English, 简体中文, हिन्दी, Español, العربية, Français, Português, Русский, Deutsch et 日本語. Les locuteurs natifs peuvent nous aider à rendre l'interface plus claire et plus naturelle. Les issues et descriptions de pull requests sont acceptées dans toutes ces langues.

- Les textes source en anglais se trouvent dans [`src/renderer/src/locales/default.json`](src/renderer/src/locales/default.json).
- Les catalogues traduits se trouvent dans [`src/renderer/src/locales`](src/renderer/src/locales).
- Consultez le [guide de localisation](AGENTS.md#user-facing-strings-live-in-defaultjson) avant de modifier les textes de l'interface ou d'ajouter une langue.
- Exécutez `npm run i18n` pour valider la structure, les variables et le balisage intégré.

## Licence

[MIT](LICENSE) © Roxy.

Roxy est un fork de [opencode](https://github.com/sst/opencode), également publié sous licence MIT, et conserve ses mentions de copyright en plus des siennes. Consultez [LICENSE](LICENSE) et [`resources/prompts/ATTRIBUTION.txt`](resources/prompts/ATTRIBUTION.txt) pour plus de détails.
