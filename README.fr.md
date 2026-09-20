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

Ce projet est un fork de [Roxy](https://github.com/roxy-gg/roxy), lui-même basé sur [opencode](https://github.com/sst/opencode).

**Téléchargement :** [https://roxy.gg](https://roxy.gg)

Roxy est une application [Electron](https://www.electronjs.org/) écrite en **TypeScript** avec une interface **React**. Son processus principal intègre un système d'agents complet (**harness**) : boucle d'appel d'outils indépendante du fournisseur, instructions système adaptées à chaque modèle, agents Plan/Build et sous-agents, gestion du contexte sur disque, serveurs MCP, diagnostics de serveurs de langage et compétences `SKILL.md`.

Au-delà de la boucle d'agents, Roxy intègre un IDE complet avec résolution des conflits Git, une compagne interactive Live2D avec synthèse vocale RVC accélérée par GPU local, un serveur relais Remote Workspace auto-hébergé pour le contrôle mobile, des boucles autonomes planifiées et des terminaux natifs.

## Fonctionnalités clés

- **Harness d'agent** — Boucle d'exécution d'outils indépendante du fournisseur avec modes Plan (lecture seule) et Build, délégation à des sous-agents, compactage automatique du contexte et déchargement des sorties volumineuses sur disque.
- **Multi-fournisseurs et points de terminaison personnalisés** — Prise en charge native d'OpenAI, Copilot (avec actualisation automatique du jeton), Anthropic, Google Gemini via le SDK Vercel AI, modèles locaux et points de terminaison personnalisés pour la génération d'images.
- **IDE intégré et opérations Git** — Éditeur de code intégré avec coloration syntaxique (Shiki), surlignage des diffs par ligne, résolveur visuel de conflits de fusion, graphe interactif de commits Git et gestion d'espaces de travail multi-dépôts.
- **Terminal intégré** — Émulateur de terminal accéléré matériellement basé sur `@xterm/xterm` et `node-pty`, prenant en charge les sessions shell persistantes, les fenêtres détachables et l'historique des commandes.
- **Compagne Live2D et synthèse vocale** — Avatar interactif Live2D de Roxy Migurdia avec expressions et réactions animées (interactions caresse sur la tête / poitrine), combiné à un TTS hors ligne RVC (Retrieval-based Voice Conversion) v2 accéléré par GPU local, saisie vocale STT faster-whisper ou voix cloud Fish Audio.
- **Espace de travail distant et relais mobile** — Appairage avec un smartphone ou une tablette via code QR et code PIN sans faire transiter votre code par des tiers ; configuré par défaut sur `https://roxy.schvis.com` (paramétrable via `ROXY_REMOTE_BASE`), avec prise en charge d'un serveur relais Next.js App Router auto-hébergé autonome dans `remote-server/` (non versionné / ignoré par git).
- **Écosystème et extensibilité** — Client Model Context Protocol (MCP) + Windows MCP, retours de diagnostics Language Server Protocol (LSP), exécuteur de compétences `SKILL.md`, automatisation persistante de navigateur Chromium et Discord Rich Presence.
- **Internationalisation complète** — Localisation complète de l'interface dans 10 langues (arabe, allemand, anglais, espagnol, français, hindi, japonais, portugais, russe, chinois) synchronisée via des outils automatisés.

## Technologies

| Couche            | Choix                                                         |
| ----------------- | ------------------------------------------------------------- |
| Bureau            | Electron 33                                                   |
| Outil de build    | electron-vite (Vite 5)                                        |
| Interface         | React 18 + TypeScript                                         |
| Styles            | Tailwind CSS v4                                               |
| Modèles & outils  | Vercel AI SDK (Anthropic, Google) + OpenAI natif, Copilot SSE |
| Terminal          | @xterm/xterm 6 + node-pty                                     |
| Visualiseurs diff | Shiki + diff                                                  |
| Intégrations      | SDK Model Context Protocol (MCP), LSP, Discord RPC            |
| Moteur vocal      | RVC v2 local (PyTorch/CUDA) + faster-whisper + API Fish Audio |
| Compagne          | Live2D Cubism Core                                            |
| Stockage          | better-sqlite3                                                |
| Packaging         | electron-builder                                              |
| Localisation      | i18next + react-i18next (10 langues)                          |
| Formatage         | Prettier                                                      |

## Structure du projet

```
roxy/
├── build/                  # Ressources de packaging (icônes, autorisations)
├── remote-server/          # Relais autonome Next.js et client mobile (ignoré par git, non versionné)
├── resources/              # Ressources statiques embarquées avec l'application
│   ├── models/live2d/      # Éléments de l'avatar compagnon Live2D Cubism
│   ├── prompts/            # Prompts système adaptés par modèle et agent (inclus via ?raw)
│   └── voicelines/         # Déclencheurs audio de la compagne interactive
├── RoxyMigurdia/           # Checkpoints du modèle vocal RVC (.pth) et index de caractéristiques (.index)
├── script/                 # Scripts de configuration, démons TTS/STT, traduction i18n et packaging
│   ├── rvc_tts_server.py   # Démon d'inférence TTS RVC local sur GPU (port 5050)
│   ├── setup_tts_env.py    # Installateur automatique de l'environnement Python et des dépendances CUDA
│   ├── transcribe.py       # Exécuteur de reconnaissance vocale STT faster-whisper
│   ├── i18n-sync.mjs       # Synchroniseur de catalogues pour default.json
│   └── i18n-translate.mjs  # Exécuteur de traduction automatique via OpenRouter
├── src/
│   ├── main/               # Processus principal Electron (Node.js)
│   │   ├── index.ts        # Cycle de vie de l'app, création des fenêtres, démarrage des services
│   │   ├── harness/        # Boucle d'agent : agent.ts (boucle de tours, schémas d'outils), tools.ts (répartition)
│   │   ├── services/       # llm.ts, aisdk.ts, mcp.ts, lsp.ts, tts.ts, stt.ts, browser.ts, remote.ts, …
│   │   ├── db/             # Stockage better-sqlite3 : schéma, migrations, couche dépôt
│   │   └── ipc/            # Gestionnaires ipcMain reliant le renderer au harness et aux services
│   ├── preload/            # Pont sécurisé entre main et renderer (window.api)
│   ├── renderer/           # Application React (Chromium) : routes, composants, store
│   │   └── src/
│   │       ├── components/ # ChatView, FileEditor, GitActionsView, Live2dCanvas, McpServers, …
│   │       └── locales/    # Source de vérité default.json et 10 catalogues de langues
│   └── shared/             # Modules purs partagés entre processus : tools, agents, prompt/prompt-text,
│                           #   providers, context, tool-history, mcp, lsp, skills, types
├── test/                   # Suites de tests smoke (app Electron, Node partagé, base, i18n, canvas)
├── electron.vite.config.ts # Configuration de build main / preload / renderer
└── electron-builder.yml    # Configuration d'empaquetage de distribution
```

## Bien démarrer

### Prérequis

- **Node.js** >= 20
- **Python** >= 3.10 (optionnel, requis pour la synthèse vocale RVC locale et le STT local)
- **GPU NVIDIA avec CUDA** (recommandé pour la conversion vocale locale ; mode CPU pris en charge)

### Installer et lancer l'application de bureau

```bash
# Installer les dépendances
npm install

# Lancer en mode développement (rechargement à chaud)
npm run dev
```

### Configuration du moteur vocal (Optionnel)

Roxy peut énoncer les réponses à l'aide d'un modèle local de conversion vocale RVC :

```bash
# 1. Installer les dépendances audio Python, PyTorch CUDA et RVC
python script/setup_tts_env.py

# 2. Démarrer le démon TTS RVC local (écoute sur http://127.0.0.1:5050)
npm run tts:server
```

Vous pouvez également activer l'**API Fish Audio** dans les Paramètres pour la synthèse vocale cloud sans nécessiter de GPU local.

## Scripts utiles

| Script                   | Description                                                                      |
| ------------------------ | -------------------------------------------------------------------------------- |
| `npm run dev`            | Lancer l'application de bureau avec rechargement à chaud                         |
| `npm run build`          | Vérifier les types et compiler main, preload et renderer                         |
| `npm run typecheck`      | Vérifier les types pour Node (`tsconfig.node.json`) et Web (`tsconfig.web.json`) |
| `npm run start`          | Prévisualiser le build de production                                             |
| `npm run tts:server`     | Démarrer le serveur vocal Python TTS RVC local                                   |
| `npm run smoke`          | Exécuter l'ensemble de la suite de tests (shared, i18n, store, multirepo, app)   |
| `npm run smoke:shared`   | Exécuter les tests rapides Node uniquement pour les modules partagés             |
| `npm run smoke:store`    | Vérifier le schéma de la base de données et les gardes de migration              |
| `npm run smoke:i18n`     | Valider les catalogues de traduction par rapport au schéma de `default.json`     |
| `npm run i18n`           | Afficher l'état d'avancement des traductions pour les 10 langues                 |
| `npm run i18n:sync`      | Synchroniser les clés des catalogues de traduction avec `default.json`           |
| `npm run i18n:translate` | Traduire les clés manquantes via OpenRouter                                      |
| `npm run format`         | Formater le code avec Prettier                                                   |
| `npm run format:check`   | Vérifier le formatage du code                                                    |
| `npm run build:win`      | Générer l'exécutable / installeur Windows                                        |
| `npm run build:mac`      | Générer le paquet d'application macOS                                            |
| `npm run build:linux`    | Générer les paquets de distribution Linux (AppImage, deb)                        |

## Architecture

- **L'isolation du contexte est activée** et `nodeIntegration` est désactivé. Le renderer communique avec le processus principal uniquement via le pont typé `window.api` défini dans [`src/preload`](src/preload/index.ts).
- Les gestionnaires IPC se trouvent dans [`src/main/ipc`](src/main/ipc/index.ts). Ajoutez une nouvelle fonctionnalité côté renderer en y enregistrant un `ipcMain.handle(...)` et en exposant la méthode correspondante dans le pont de préchargement.

### Harness d'agent

Le processus principal exécute une boucle d'agent unique et indépendante du fournisseur ; le renderer ne fait que consommer les événements diffusés.

- **Boucle d'outils** — [`src/main/harness/agent.ts`](src/main/harness/agent.ts) gère la boucle de tours, les schémas JSON des outils (`BASE_SCHEMAS`), la réduction du contexte et la délégation aux sous-agents. [`tools.ts`](src/main/harness/tools.ts) est le dispatcher officiel de `runTool`. Le catalogue utilisateur dans [`src/shared/tools.ts`](src/shared/tools.ts) le reflète (page « Compétences & Outils ») et est protégé contre toute dérive par la suite de tests partagée.
- **Fournisseurs** — La communication SSE personnalisée OpenAI/Copilot (avec rafraîchissement des jetons éphémères de Copilot) se trouve dans [`services/llm.ts`](src/main/services/llm.ts) ; Anthropic + Google transitent par le SDK Vercel AI dans [`services/aisdk.ts`](src/main/services/aisdk.ts) afin que chaque famille bénéficie de l'appel d'outils.
- **Prompts et agents** — Les prompts réglés par modèle sont sélectionnés dans [`src/shared/prompt.ts`](src/shared/prompt.ts) et intégrés depuis `resources/prompts/*.txt` via `?raw` dans [`prompt-text.ts`](src/shared/prompt-text.ts). Les agents Plan/Build et les sous-agents sont définis dans [`src/shared/agents.ts`](src/shared/agents.ts) ; la liste d'outils autorisés (`tools`) et le `promptFile` garantissent que le mode Plan est strictement en lecture seule.
- **Gestion du contexte** — Les dépassements de contexte sont calculés selon la limite réelle du modèle ([`src/shared/context.ts`](src/shared/context.ts)) ; les sorties volumineuses des outils sont déchargées sur disque avec un pointeur d'aperçu ([`services/tool-output-store.ts`](src/main/services/tool-output-store.ts)) ; les tours plus anciens sont résumés par [`services/compaction.ts`](src/main/services/compaction.ts).
- **Écosystème** — Serveurs d'outils externes via le client MCP ([`services/mcp.ts`](src/main/services/mcp.ts)), retours de diagnostics de serveurs de langage après modifications ([`services/lsp.ts`](src/main/services/lsp.ts)) et compétences à la demande `SKILL.md` ([`services/skills.ts`](src/main/services/skills.ts)). L'outillage de navigation Chromium persistant ([`services/browser.ts`](src/main/services/browser.ts)) et les boucles périodiques programmées ([`services/loops.ts`](src/main/services/loops.ts)) s'exécutent au sein de la même boucle.

### IDE intégré et flux Git

- **Éditeur de fichiers et arborescence** — [`src/renderer/src/components/FileEditor.tsx`](src/renderer/src/components/FileEditor.tsx) propose un éditeur intégré avec coloration syntaxique Shiki, onglets de fichiers actifs et pièces jointes de contexte.
- **Actions Git et résolveur de conflits** — [`src/renderer/src/components/GitActionsView.tsx`](src/renderer/src/components/GitActionsView.tsx) et [`MergeConflictSolver.tsx`](src/renderer/src/components/MergeConflictSolver.tsx) affichent l'historique visuel des branches, les changements indexés, l'inspection des diffs et la résolution de conflits de fusion à 3 voies.
- **Émulateur de terminal** — Conçu avec `@xterm/xterm` et `node-pty`, avec des sessions shell gérées dans [`src/main/services/shell-session.ts`](src/main/services/shell-session.ts) et [`src/renderer/src/components/TerminalView.tsx`](src/renderer/src/components/TerminalView.tsx).

### Compagne Live2D et synthèse vocale

- **Avatar Live2D** — Rendu via Cubism Core dans [`Live2dCanvas.tsx`](src/renderer/src/components/Live2dCanvas.tsx) et [`VtuberStandalone.tsx`](src/renderer/src/components/VtuberStandalone.tsx) avec moteur physique interactif, déclencheurs d'expressions et synchronisation labiale audio.
- **Inférence RVC v2** — Le démon Python local [`script/rvc_tts_server.py`](script/rvc_tts_server.py) combine la génération edge-tts avec la conversion de hauteur/timbre sur GPU local grâce aux checkpoints de `RoxyMigurdia/`.
- **Reconnaissance vocale (STT)** — [`src/main/services/stt.ts`](src/main/services/stt.ts) capture les instructions vocales et les transcrit localement via faster-whisper ([`script/transcribe.py`](script/transcribe.py)).

### Espace de travail distant

Emportez une session active sur votre téléphone. **Remote Workspace** (groupe **CUSTOMIZE** en bas à gauche de la barre latérale) crée un salon, affiche un code QR + URL sécurisée + PIN, et conserve votre ordinateur comme hôte principal tandis que le téléphone sert de client léger — **votre code et vos fichiers ne quittent jamais votre machine** ; seuls la transcription du chat et les événements d'agents sont relayés.

- **Service hôte** — [`main/services/remote.ts`](src/main/services/remote.ts) instancie la session sur le relais (configuré via `ROXY_REMOTE_BASE`, par défaut `https://roxy.schvis.com`), détient le **jeton d'hôte** et maintient une connexion WebSocket permanente. À la réception de `hello`, il transmet un instantané de l'historique ; sur un `prompt`, il exécute le tour localement tout en diffusant chaque `LlmEvent` en continu vers le téléphone et le renderer local simultanément.
- **Boucle unique, aucune divergence** — Les appels IPC locaux `llm:start` et les prompts distants s'exécutent tous les deux via `runSessionTurn` dans [`main/services/session-turn.ts`](src/main/services/session-turn.ts).
- **Sécurité** — Authentification sans connexion préalable : un jeton d'invité HMAC éphémère est transmis dans le fragment d'URL et le téléphone doit renseigner le **code PIN** à 6 chiffres affiché sur l'ordinateur. Le salon est automatiquement révoqué à l'arrêt, après plusieurs tentatives incorrectes de PIN ou lors de la déconnexion de l'ordinateur.

<a id="translations"></a>

## Traductions

Roxy est disponible en English, 简体中文, हिन्दी, Español, العربية, Français, Português, Русский, Deutsch et 日本語. Les locuteurs natifs peuvent nous aider à rendre l'interface plus claire et plus naturelle. Les issues et descriptions de pull requests sont les bienvenues dans toutes ces langues.

- Les textes source en anglais se trouvent dans [`src/renderer/src/locales/default.json`](src/renderer/src/locales/default.json).
- Les catalogues traduits se trouvent dans [`src/renderer/src/locales`](src/renderer/src/locales).
- Consultez le [guide de localisation](AGENTS.md#user-facing-strings-live-in-defaultjson) avant de modifier les textes de l'interface ou d'ajouter une langue.
- Exécutez `npm run i18n` pour valider la structure des catalogues, les espaces réservés et les balises en ligne.

## Licence

[MIT](LICENSE) © Roxy.

Ce projet est un fork de [Roxy](https://github.com/roxy-gg/roxy), basé sur [opencode](https://github.com/sst/opencode) (également sous licence MIT), et conserve leurs mentions de droits d'auteur aux côtés des siennes. Consultez [LICENSE](LICENSE) et [`resources/prompts/ATTRIBUTION.txt`](resources/prompts/ATTRIBUTION.txt) pour plus de détails.
