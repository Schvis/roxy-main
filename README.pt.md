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

**Download:** [https://roxy.gg](https://roxy.gg)

Roxy é um aplicativo [Electron](https://www.electronjs.org/) escrito em **TypeScript** com interface em **React**. O processo principal inclui um sistema completo de agentes: loop de ferramentas independente do provedor, instruções ajustadas para cada modelo, agentes Plan/Build e subagentes, gerenciamento de contexto em disco, servidores MCP, diagnósticos de servidores de linguagem e habilidades `SKILL.md`.

## Tecnologias

| Camada            | Tecnologia                         |
| ----------------- | ---------------------------------- |
| Desktop           | Electron 33                        |
| Build             | electron-vite (Vite 5)             |
| Interface         | React 18 + TypeScript              |
| Estilos           | Tailwind CSS v4                    |
| Ferramentas de IA | Vercel AI SDK (Anthropic + Google) |
| Integrações       | Model Context Protocol SDK         |
| Armazenamento     | better-sqlite3                     |
| Empacotamento     | electron-builder                   |
| Formatação        | Prettier                           |

## Estrutura do projeto

```text
roxy/
├── build/                  # Recursos de empacotamento: ícones e permissões
├── resources/              # Recursos estáticos incluídos no aplicativo
│   └── prompts/            # Instruções ajustadas por modelo e agente
├── src/
│   ├── main/               # Processo principal do Electron (Node.js)
│   │   ├── index.ts        # Ciclo de vida, janelas e início dos serviços
│   │   ├── harness/        # Loop do agente e execução das ferramentas
│   │   ├── services/       # LLM, MCP, LSP, habilidades, navegador e loops
│   │   ├── db/             # Esquema, migrações e repositório better-sqlite3
│   │   └── ipc/            # Ligação IPC entre a interface e os serviços
│   ├── preload/            # Ponte segura window.api
│   ├── renderer/           # Aplicativo React (Chromium)
│   └── shared/             # Módulos compartilhados entre processos
├── test/                   # Testes de fumaça e validação
├── electron.vite.config.ts # Configuração de build
└── electron-builder.yml    # Configuração de distribuição
```

## Primeiros passos

```bash
# Instalar as dependências
npm install

# Executar em desenvolvimento com recarga automática
npm run dev
```

## Scripts úteis

| Script                | Descrição                                      |
| --------------------- | ---------------------------------------------- |
| `npm run dev`         | Inicia o aplicativo com recarga automática     |
| `npm run build`       | Verifica os tipos e cria o build de produção   |
| `npm run typecheck`   | Verifica os tipos de main, preload e renderer  |
| `npm run smoke`       | Executa os testes compartilhados e do Electron |
| `npm run format`      | Formata o repositório com Prettier             |
| `npm run build:win`   | Cria o instalador para Windows                 |
| `npm run build:mac`   | Cria o aplicativo para macOS                   |
| `npm run build:linux` | Cria pacotes para Linux (AppImage e deb)       |

## Arquitetura

- O isolamento de contexto está ativado e `nodeIntegration` está desativado. A interface se comunica com o processo principal somente pela ponte tipada `window.api`, definida em [`src/preload`](src/preload/index.ts).
- Os manipuladores IPC ficam em [`src/main/ipc`](src/main/ipc/index.ts). Novos recursos para a interface devem registrar um `ipcMain.handle(...)` e expor o método correspondente na ponte de pré-carregamento.

### Sistema de agentes

O processo principal executa um único loop de agente independente do provedor; a interface apenas recebe os eventos transmitidos.

- **Loop de ferramentas:** [`src/main/harness/agent.ts`](src/main/harness/agent.ts) controla os turnos, os esquemas `BASE_SCHEMAS`, a redução de contexto e os subagentes. [`tools.ts`](src/main/harness/tools.ts) contém o despachante `runTool`.
- **Provedores:** a integração SSE de OpenAI/Copilot fica em [`services/llm.ts`](src/main/services/llm.ts). Anthropic e Google usam Vercel AI SDK por meio de [`services/aisdk.ts`](src/main/services/aisdk.ts).
- **Instruções e agentes:** [`src/shared/prompt.ts`](src/shared/prompt.ts) escolhe as instruções de cada modelo. Os agentes Plan/Build e os subagentes são definidos em [`src/shared/agents.ts`](src/shared/agents.ts).
- **Gerenciamento de contexto:** [`src/shared/context.ts`](src/shared/context.ts) mede o limite real de cada modelo; saídas grandes são armazenadas em disco e turnos antigos são compactados.
- **Ecossistema:** MCP, diagnósticos LSP, habilidades `SKILL.md`, o navegador persistente e os loops recorrentes usam o mesmo sistema de agentes.

### Espaço de trabalho remoto

Continue uma sessão ativa pelo telefone. **Remote Workspace** cria uma sala no roxy.gg, mostra um código QR, uma URL segura e um PIN, mantendo o computador como host principal. **Seu código e seus arquivos nunca saem da máquina**; somente a conversa e os eventos do agente são retransmitidos.

- [`main/services/remote.ts`](src/main/services/remote.ts) cria a sessão com `POST https://roxy.gg/api/remote/sessions`, guarda o token do host e mantém a conexão WebSocket.
- Solicitações locais e remotas usam `runSessionTurn` em [`main/services/session-turn.ts`](src/main/services/session-turn.ts), portanto têm o mesmo comportamento.
- A API IPC inclui `remote:start`, `remote:stop`, `remote:status` e eventos `remote:state`. A janela do código QR fica em [`renderer/src/components/RemoteWorkspaceDialog.tsx`](src/renderer/src/components/RemoteWorkspaceDialog.tsx).
- A sala é revogada ao parar o compartilhamento, após muitos PINs incorretos, ao expirar ou pouco depois da desconexão do computador. Consulte o protocolo no [README do roxy.gg](../roxy.gg/README.md#remote-workspace).

<a id="translations"></a>

## Traduções

Roxy está disponível em English, 简体中文, हिन्दी, Español, العربية, Français, Português, Русский, Deutsch e 日本語. Falantes nativos podem ajudar a deixar a interface mais clara e natural. Aceitamos issues e descrições de pull requests em qualquer um desses idiomas.

- Os textos-fonte em inglês ficam em [`src/renderer/src/locales/default.json`](src/renderer/src/locales/default.json).
- Os catálogos traduzidos ficam em [`src/renderer/src/locales`](src/renderer/src/locales).
- Consulte o [guia de localização](AGENTS.md#user-facing-strings-live-in-defaultjson) antes de alterar textos da interface ou adicionar um idioma.
- Execute `npm run i18n` para validar a estrutura, os marcadores e a marcação incorporada.

## Licença

[MIT](LICENSE) © Roxy.

Roxy é um fork do [opencode](https://github.com/sst/opencode), também publicado sob a licença MIT, e mantém os avisos de copyright dele junto com os próprios. Consulte [LICENSE](LICENSE) e [`resources/prompts/ATTRIBUTION.txt`](resources/prompts/ATTRIBUTION.txt) para mais detalhes.
