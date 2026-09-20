<p align="center">
  <a href="https://roxy.gg">
    <img src="roxy.png" alt="Roxy" width="640" />
  </a>
</p>

<p align="center">
  <strong>Idiomas:</strong>
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
  <a href="#translations">Contribua no seu idioma</a>
</p>

# Roxy

> Um agente de programação com IA, de código aberto e feito para engenheiros como aplicativo desktop multiplataforma.

Este projeto é um fork do [Roxy](https://github.com/roxy-gg/roxy), que é baseado no [opencode](https://github.com/sst/opencode).

**Download:** [https://roxy.gg](https://roxy.gg)

Roxy é um aplicativo [Electron](https://www.electronjs.org/) escrito em **TypeScript** com interface em **React**. O processo principal inclui um sistema completo de agentes (**harness**): loop de execução de ferramentas independente do provedor, prompts de sistema ajustados para cada modelo, agentes Plan/Build e subagentes, gerenciamento de contexto em disco, servidores MCP, diagnósticos de servidores de linguagem e habilidades `SKILL.md`.

Além do loop de agentes, o Roxy integra uma IDE integrada com resolução de conflitos Git, uma companheira interativa em Live2D com síntese de voz RVC acelerada por GPU local, um servidor relay Remote Workspace auto-hospedado para controle móvel, loops autônomos agendados e terminais nativos.

## Recursos principais

- **Harness de agente** — Loop de execução de ferramentas independente do provedor com modos Plan (somente leitura) e Build, delegação para subagentes, compactação automática de contexto e descarregamento de saídas grandes de ferramentas em disco.
- **Múltiplos provedores e endpoints customizados** — Suporte nativo a OpenAI, Copilot (com atualização automática de token), Anthropic, Google Gemini via Vercel AI SDK, modelos locais e endpoints customizados para geração de imagens.
- **IDE integrada e operações Git** — Editor de código integrado com destaque de sintaxe (Shiki), decorações de diff por linha, solucionador visual de conflitos de merge, grafo interativo de commits Git e gerenciamento de workspace multirrepositório.
- **Terminal integrado** — Emulador de terminal acelerado por hardware baseado em `@xterm/xterm` e `node-pty`, com suporte a sessões de shell persistentes, janelas popout e histórico de comandos.
- **Companheira Live2D e síntese de voz** — Avatar interativo Live2D de Roxy Migurdia com expressões animadas e reações (interações de carinho na cabeça / peito), combinado com TTS RVC (Retrieval-based Voice Conversion) v2 local acelerado por GPU, entrada de voz STT com faster-whisper ou voz em nuvem Fish Audio.
- **Espaço de trabalho remoto e relay móvel** — Pareie com celular ou tablet via QR code e PIN sem trafegar código por terceiros; padrão em `https://roxy.schvis.com` (configurável via `ROXY_REMOTE_BASE`), com suporte a servidor relay Next.js App Router auto-hospedado em `remote-server/` (não commitado / ignorado pelo git).
- **Ecossistema e extensibilidade** — Cliente Model Context Protocol (MCP) + Windows MCP, feedback de diagnósticos de Language Server Protocol (LSP), executor de habilidades `SKILL.md`, automação persistente de navegador Chromium e Discord Rich Presence.
- **Internacionalização completa** — Localização completa da interface em 10 idiomas (árabe, alemão, inglês, espanhol, francês, híndi, japonês, português, russo, chinês) sincronizada via ferramentas automatizadas.

## Tecnologias

| Camada            | Escolha                                                        |
| ----------------- | -------------------------------------------------------------- |
| Desktop           | Electron 33                                                    |
| Ferramenta build  | electron-vite (Vite 5)                                         |
| Interface         | React 18 + TypeScript                                          |
| Estilos           | Tailwind CSS v4                                                |
| Ferramentas e IA  | Vercel AI SDK (Anthropic, Google) + OpenAI nativo, Copilot SSE |
| Terminal          | @xterm/xterm 6 + node-pty                                      |
| Visualizador diff | Shiki + diff                                                   |
| Integrações       | SDK Model Context Protocol (MCP), LSP, Discord RPC             |
| Motor de voz      | RVC v2 local (PyTorch/CUDA) + faster-whisper + Fish Audio API  |
| Companheira       | Live2D Cubism Core                                             |
| Armazenamento     | better-sqlite3                                                 |
| Empacotamento     | electron-builder                                               |
| Localização       | i18next + react-i18next (10 idiomas)                           |
| Formatação        | Prettier                                                       |

## Estrutura do projeto

```
roxy/
├── build/                  # Recursos de empacotamento (ícones, permissões)
├── remote-server/          # Relay Next.js e cliente móvel autônomo (ignorado pelo git, fora do repositório)
├── resources/              # Recursos estáticos incluídos no aplicativo
│   ├── models/live2d/      # Recursos do avatar de companheira Live2D Cubism
│   ├── prompts/            # Prompts de sistema ajustados por modelo e agente (embutidos via ?raw)
│   └── voicelines/         # Disparadores de áudio interativos da companheira
├── RoxyMigurdia/           # Checkpoints do modelo de voz RVC (.pth) e índices de recursos (.index)
├── script/                 # Scripts de configuração, daemons TTS/STT, tradução i18n e empacotamento
│   ├── rvc_tts_server.py   # Daemon de inferência RVC TTS em GPU local (porta 5050)
│   ├── setup_tts_env.py    # Instalador automático do ambiente Python e dependências CUDA
│   ├── transcribe.py       # Executor de reconhecimento de voz STT faster-whisper
│   ├── i18n-sync.mjs       # Sincronizador de catálogos para default.json
│   └── i18n-translate.mjs  # Executor de tradução automática via OpenRouter
├── src/
│   ├── main/               # Processo principal do Electron (Node.js)
│   │   ├── index.ts        # Ciclo de vida da app, criação de janelas, início de serviços
│   │   ├── harness/        # Loop do agente: agent.ts (turnos, schemas), tools.ts (despacho)
│   │   ├── services/       # llm.ts, aisdk.ts, mcp.ts, lsp.ts, tts.ts, stt.ts, browser.ts, remote.ts, …
│   │   ├── db/             # Armazenamento better-sqlite3: esquema, migrações, camada de repositório
│   │   └── ipc/            # Handlers ipcMain conectando o renderer ao harness e serviços
│   ├── preload/            # Ponte segura entre main e renderer (window.api)
│   ├── renderer/           # Aplicativo React (Chromium): rotas, componentes, store
│   │   └── src/
│   │       ├── components/ # ChatView, FileEditor, GitActionsView, Live2dCanvas, McpServers, …
│   │       └── locales/    # Fonte da verdade default.json e 10 catálogos de idiomas
│   └── shared/             # Módulos puros compartilhados entre processos: tools, agents, prompt/prompt-text,
│                           #   providers, context, tool-history, mcp, lsp, skills, types
├── test/                   # Suítes de testes de fumaça (app Electron, Node compartilhado, store, i18n, canvas)
├── electron.vite.config.ts # Configuração de build main / preload / renderer
└── electron-builder.yml    # Configuração de empacotamento para distribuição
```

## Primeiros passos

### Pré-requisitos

- **Node.js** >= 20
- **Python** >= 3.10 (opcional, necessário para síntese de voz RVC local e STT local)
- **GPU NVIDIA com CUDA** (recomendado para conversão de voz local; modo CPU suportado)

### Instalar e executar o aplicativo desktop

```bash
# Instalar dependências
npm install

# Executar em desenvolvimento (hot reload)
npm run dev
```

### Configuração do motor de voz (Opcional)

O Roxy pode falar respostas usando um modelo de conversão de voz RVC local:

```bash
# 1. Instalar dependências de áudio do Python, PyTorch CUDA e RVC
python script/setup_tts_env.py

# 2. Iniciar o daemon RVC TTS local (escuta em http://127.0.0.1:5050)
npm run tts:server
```

Você também pode ativar a **Fish Audio API** nas Configurações para síntese de voz em nuvem sem requisitos de GPU local.

## Scripts úteis

| Script                   | Descrição                                                                    |
| ------------------------ | ---------------------------------------------------------------------------- |
| `npm run dev`            | Iniciar aplicativo desktop com hot reload                                    |
| `npm run build`          | Verificar tipos e compilar main, preload e renderer                          |
| `npm run typecheck`      | Verificar tipos para Node (`tsconfig.node.json`) e Web (`tsconfig.web.json`) |
| `npm run start`          | Pré-visualizar build de produção                                             |
| `npm run tts:server`     | Iniciar o servidor de voz Python RVC TTS local                               |
| `npm run smoke`          | Executar suíte completa de testes (shared, i18n, store, multirepo, app)      |
| `npm run smoke:shared`   | Executar testes rápidos em Node para módulos compartilhados                  |
| `npm run smoke:store`    | Verificar esquema do banco de dados e proteções de migração                  |
| `npm run smoke:i18n`     | Validar catálogos de tradução contra o esquema do `default.json`             |
| `npm run i18n`           | Relatar status de conclusão da tradução nos 10 idiomas                       |
| `npm run i18n:sync`      | Sincronizar chaves dos catálogos com `default.json`                          |
| `npm run i18n:translate` | Traduzir chaves ausentes usando OpenRouter                                   |
| `npm run format`         | Formatar código com Prettier                                                 |
| `npm run format:check`   | Verificar formatação do código                                               |
| `npm run build:win`      | Gerar executável / instalador para Windows                                   |
| `npm run build:mac`      | Gerar pacote de aplicativo para macOS                                        |
| `npm run build:linux`    | Gerar pacotes de distribuição Linux (AppImage, deb)                          |

## Notas de arquitetura

- **O isolamento de contexto está ativado** e `nodeIntegration` está desativado. O renderer se comunica com o processo principal apenas por meio da ponte tipada `window.api` definida em [`src/preload`](src/preload/index.ts).
- Os handlers IPC residem em [`src/main/ipc`](src/main/ipc/index.ts). Adicione um novo recurso para o renderer registrando um `ipcMain.handle(...)` lá e expondo o método correspondente na ponte de pré-carregamento.

### Harness do agente

O processo principal executa um único loop de agente independente de provedor; o renderer apenas recebe os eventos transmitidos.

- **Loop de ferramentas** — [`src/main/harness/agent.ts`](src/main/harness/agent.ts) gerencia o loop de turnos, os esquemas JSON de ferramentas (`BASE_SCHEMAS`), o corte de contexto e o despacho para subagentes. [`tools.ts`](src/main/harness/tools.ts) é o despachante oficial `runTool`. O catálogo voltado para a interface em [`src/shared/tools.ts`](src/shared/tools.ts) o espelha (a página «Skills & Tools») e é protegido contra desvios pela suíte de testes compartilhada.
- **Provedores** — O fluxo SSE manual para OpenAI/Copilot (com atualização do token efêmero do Copilot) fica em [`services/llm.ts`](src/main/services/llm.ts); Anthropic + Google passam pelo Vercel AI SDK em [`services/aisdk.ts`](src/main/services/aisdk.ts) para que todas as famílias suportem chamadas de ferramentas.
- **Prompts e agentes** — Prompts ajustados por modelo são selecionados em [`src/shared/prompt.ts`](src/shared/prompt.ts) e incorporados a partir de `resources/prompts/*.txt` via `?raw` em [`prompt-text.ts`](src/shared/prompt-text.ts). Agentes Plan/Build e subagentes são definidos em [`src/shared/agents.ts`](src/shared/agents.ts); a lista de ferramentas permitidas (`tools`) e o `promptFile` de um agente garantem que Plan seja estritamente somente leitura.
- **Gerenciamento de contexto** — O excesso de contexto é calculado contra o limite real do modelo ([`src/shared/context.ts`](src/shared/context.ts)); saídas volumosas de ferramentas são descarregadas para o disco com um ponteiro de pré-visualização ([`services/tool-output-store.ts`](src/main/services/tool-output-store.ts)); turnos antigos são resumidos por [`services/compaction.ts`](src/main/services/compaction.ts).
- **Ecossistema** — Servidores de ferramentas externos via cliente MCP ([`services/mcp.ts`](src/main/services/mcp.ts)), diagnósticos de Language Server retornados após edições ([`services/lsp.ts`](src/main/services/lsp.ts)) e habilidades `SKILL.md` sob demanda ([`services/skills.ts`](src/main/services/skills.ts)). O conjunto de ferramentas de navegador Chromium persistente do Roxy ([`services/browser.ts`](src/main/services/browser.ts)) e loops recorrentes agendados ([`services/loops.ts`](src/main/services/loops.ts)) rodam dentro do mesmo loop.

### IDE integrada e fluxo Git

- **Editor de arquivos e árvore** — [`src/renderer/src/components/FileEditor.tsx`](src/renderer/src/components/FileEditor.tsx) oferece um editor integrado com realce de sintaxe Shiki, abas de arquivos ativos e anexação de contexto.
- **Ações Git e solucionador de conflitos** — [`src/renderer/src/components/GitActionsView.tsx`](src/renderer/src/components/GitActionsView.tsx) e [`MergeConflictSolver.tsx`](src/renderer/src/components/MergeConflictSolver.tsx) exibem o histórico visual de branches, alterações preparadas, inspeção de diffs e resolução de conflitos de merge em 3 vias.
- **Emulador de terminal** — Construído sobre `@xterm/xterm` e `node-pty`, com sessões shell gerenciadas em [`src/main/services/shell-session.ts`](src/main/services/shell-session.ts) e [`src/renderer/src/components/TerminalView.tsx`](src/renderer/src/components/TerminalView.tsx).

### Companheira Live2D e síntese de voz

- **Avatar Live2D** — Renderizado via Cubism Core em [`Live2dCanvas.tsx`](src/renderer/src/components/Live2dCanvas.tsx) e [`VtuberStandalone.tsx`](src/renderer/src/components/VtuberStandalone.tsx) com física interativa, gatilhos de expressão e sincronização labial com áudio.
- **Inferência RVC v2** — O daemon local em Python [`script/rvc_tts_server.py`](script/rvc_tts_server.py) combina geração edge-tts com conversão de tom/timbre em GPU local usando checkpoints em `RoxyMigurdia/`.
- **Reconhecimento de voz (STT)** — [`src/main/services/stt.ts`](src/main/services/stt.ts) captura comandos de voz e transcreve localmente usando faster-whisper ([`script/transcribe.py`](script/transcribe.py)).

### Espaço de trabalho remoto

Leve uma sessão em execução para o seu celular. O **Remote Workspace** (grupo **CUSTOMIZE** no canto inferior esquerdo da barra lateral) cria uma sala, exibe QR code + URL segura + PIN e mantém o computador como host principal enquanto o celular atua como cliente leve — **seu código e arquivos nunca saem da sua máquina**; apenas o histórico do chat e os eventos transmitidos do agente são repassados.

- **Serviço de host** — [`main/services/remote.ts`](src/main/services/remote.ts) instancia a sessão no relay (configurado via `ROXY_REMOTE_BASE`, padrão `https://roxy.schvis.com`), retém o **token do host** e mantém conexão WebSocket contínua. Em um `hello` do convidado, envia snapshot do histórico; em um `prompt` do convidado, executa o turno localmente transmitindo cada `LlmEvent` para o celular e o renderer local simultaneamente.
- **Loop único, sem divergência** — Chamadas IPC locais `llm:start` e prompts remotos são executados via `runSessionTurn` em [`main/services/session-turn.ts`](src/main/services/session-turn.ts).
- **Segurança** — Autenticação sem login: um token de convidado HMAC efêmero é transmitido no fragmento da URL e o celular deve fornecer o **PIN** de 6 dígitos exibido no computador. As salas são revogadas ao parar, após repetidas tentativas incorretas de PIN ou na desconexão do computador.

<a id="translations"></a>

## Traduções

O Roxy está disponível em English, 简体中文, हिन्दी, Español, العربية, Français, Português, Русский, Deutsch e 日本語. Falantes nativos podem ajudar a deixar a interface mais clara e natural. Issues e descrições de pull requests são bem-vindas em qualquer um desses idiomas.

- Os textos de origem em inglês ficam em [`src/renderer/src/locales/default.json`](src/renderer/src/locales/default.json).
- Os catálogos de tradução ficam em [`src/renderer/src/locales`](src/renderer/src/locales).
- Consulte o [guia de localização](AGENTS.md#user-facing-strings-live-in-defaultjson) antes de editar textos da interface ou adicionar um idioma.
- Execute `npm run i18n` para validar estrutura do catálogo, placeholders e marcação inline.

## Licença

[MIT](LICENSE) © Roxy.

Este projeto é um fork do [Roxy](https://github.com/roxy-gg/roxy), que é baseado no [opencode](https://github.com/sst/opencode) (também sob licença MIT), e mantém seus avisos de copyright juntamente com os deste projeto. Consulte [LICENSE](LICENSE) e [`resources/prompts/ATTRIBUTION.txt`](resources/prompts/ATTRIBUTION.txt) para detalhes.
