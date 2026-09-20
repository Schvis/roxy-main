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
  <a href="#translations">Contribuye en tu idioma</a>
</p>

# Roxy

> Un agente de programación con IA, de código abierto y creado para ingenieros como aplicación de escritorio multiplataforma.

Este proyecto es un fork de [Roxy](https://github.com/roxy-gg/roxy), que está basado en [opencode](https://github.com/sst/opencode).

**Descarga:** [https://roxy.gg](https://roxy.gg)

Roxy es una aplicación [Electron](https://www.electronjs.org/) escrita en **TypeScript** con una interfaz en **React**. El proceso principal incluye un sistema completo de agentes (**harness**): un bucle de ejecución de herramientas independiente del proveedor, instrucciones del sistema ajustadas por modelo, agentes Plan/Build y subagentes, gestión de contexto respaldada en disco e integraciones con servidores MCP, diagnósticos de servidores de lenguaje y habilidades `SKILL.md`.

Más allá del bucle del agente, Roxy integra un IDE integrado con resolución de conflictos de Git, una compañera interactiva en Live2D con síntesis de voz RVC acelerada por GPU local, un servidor de retransmisión Remote Workspace autohospedado para control móvil, bucles autónomos programados y terminales nativas.

## Características principales

- **Harness de agente** — Bucle de ejecución de herramientas independiente del proveedor con modos Plan (solo lectura) y Build, delegación en subagentes, compactación automática de contexto y almacenamiento de salidas grandes de herramientas en disco.
- **Múltiples proveedores y endpoints personalizados** — Soporte nativo para OpenAI, Copilot (con actualización automática de tokens), Anthropic, Google Gemini a través de Vercel AI SDK, modelos locales y endpoints personalizados para generación de imágenes.
- **IDE integrado y operaciones de Git** — Editor de código integrado con resaltado de sintaxis (Shiki), decoración de diferencias por línea, solucionador visual de conflictos de fusión, gráfico interactivo de commits de Git y gestión de espacios de trabajo multirrepositorio.
- **Terminal integrada** — Emulador de terminal con aceleración por hardware basado en `@xterm/xterm` y `node-pty`, compatible con sesiones de shell persistentes, ventanas emergentes independientes e historial de comandos.
- **Compañera Live2D y síntesis de voz** — Avatar interactivo en Live2D de Roxy Migurdia con expresiones y reacciones animadas (interacciones de caricias en la cabeza / pecho), junto con TTS RVC (Retrieval-based Voice Conversion) v2 acelerado por GPU local sin conexión, entrada de voz STT con faster-whisper o voz en la nube de Fish Audio.
- **Espacio de trabajo remoto y retransmisión móvil** — Emparejamiento con teléfono o tableta mediante código QR y PIN sin transferir código a través de terceros; de forma predeterminada en `https://roxy.schvis.com` (configurable mediante `ROXY_REMOTE_BASE`), con soporte para un servidor de retransmisión Next.js App Router autohospedado e independiente en `remote-server/` (sin commits / ignorado por git).
- **Ecosistema y extensibilidad** — Cliente de Model Context Protocol (MCP) + Windows MCP, retroalimentación de diagnósticos de Language Server Protocol (LSP), ejecutor de habilidades `SKILL.md`, automatización persistente de navegador Chromium y Discord Rich Presence.
- **Internacionalización completa** — Localización completa de la interfaz en 10 idiomas (árabe, alemán, inglés, español, francés, hindi, japonés, portugués, ruso y chino) sincronizada mediante herramientas automatizadas.

## Tecnologías

| Capa                   | Tecnología                                                     |
| ---------------------- | -------------------------------------------------------------- |
| Escritorio             | Electron 33                                                    |
| Herramienta de build   | electron-vite (Vite 5)                                         |
| Interfaz               | React 18 + TypeScript                                          |
| Estilos                | Tailwind CSS v4                                                |
| Herramientas y modelos | Vercel AI SDK (Anthropic, Google) + OpenAI nativo, Copilot SSE |
| Terminal               | @xterm/xterm 6 + node-pty                                      |
| Visor de código y diff | Shiki + diff                                                   |
| Integraciones          | Model Context Protocol (MCP) SDK, LSP, Discord RPC             |
| Motor de voz           | RVC v2 local (PyTorch/CUDA) + faster-whisper + Fish Audio API  |
| Compañera              | Live2D Cubism Core                                             |
| Almacenamiento         | better-sqlite3                                                 |
| Empaquetado            | electron-builder                                               |
| Localización           | i18next + react-i18next (10 idiomas)                           |
| Formato                | Prettier                                                       |

## Estructura del proyecto

```
roxy/
├── build/                  # Recursos de empaquetado (iconos, autorizaciones)
├── remote-server/          # Retransmisión Next.js y cliente móvil independiente (ignorado por git, no en commits)
├── resources/              # Recursos estáticos empaquetados con la aplicación
│   ├── models/live2d/      # Activos del avatar de compañera Live2D Cubism
│   ├── prompts/            # Prompts de sistema ajustados por modelo y agente (insertados con ?raw)
│   └── voicelines/         # Disparadores de audio interactivos de la compañera
├── RoxyMigurdia/           # Checkpoints del modelo de voz RVC (.pth) e índices de características (.index)
├── script/                 # Scripts de configuración, demonios TTS/STT, traducción i18n y empaquetado
│   ├── rvc_tts_server.py   # Demonio de inferencia TTS RVC local con GPU (puerto 5050)
│   ├── setup_tts_env.py    # Instalador automático del entorno de Python y dependencias de CUDA
│   ├── transcribe.py       # Ejecutor de reconocimiento de voz STT con faster-whisper
│   ├── i18n-sync.mjs       # Sincronizador de catálogos para default.json
│   └── i18n-translate.mjs  # Ejecutor de traducción automática a través de OpenRouter
├── src/
│   ├── main/               # Proceso principal de Electron (Node.js)
│   │   ├── index.ts        # Ciclo de vida de la app, creación de ventanas, inicio de servicios
│   │   ├── harness/        # Bucle de agente: agent.ts (turnos, esquemas de herramientas), tools.ts (despacho)
│   │   ├── services/       # llm.ts, aisdk.ts, mcp.ts, lsp.ts, tts.ts, stt.ts, browser.ts, remote.ts, …
│   │   ├── db/             # Almacén better-sqlite3: esquema, migraciones, capa de repositorio
│   │   └── ipc/            # Manejadores ipcMain que conectan el renderer con harness y servicios
│   ├── preload/            # Puente seguro entre main y renderer (window.api)
│   ├── renderer/           # Aplicación React (Chromium): rutas, componentes, almacén
│   │   └── src/
│   │       ├── components/ # ChatView, FileEditor, GitActionsView, Live2dCanvas, McpServers, …
│   │       └── locales/    # Fuente de verdad default.json y 10 catálogos de idiomas
│   └── shared/             # Módulos puros compartidos entre procesos: tools, agents, prompt/prompt-text,
│                           #   providers, context, tool-history, mcp, lsp, skills, types
├── test/                   # Suites de pruebas de humo (app Electron, Node compartido, almacén, i18n, canvas)
├── electron.vite.config.ts # Configuración de compilación para main / preload / renderer
└── electron-builder.yml    # Configuración de empaquetado de distribución
```

## Primeros pasos

### Requisitos previos

- **Node.js** >= 20
- **Python** >= 3.10 (opcional, requerido para síntesis de voz RVC local y STT local)
- **GPU NVIDIA con CUDA** (recomendado para conversión de voz local; compatible con modo CPU)

### Instalar y ejecutar la aplicación de escritorio

```bash
# Instalar dependencias
npm install

# Ejecutar en desarrollo (recarga en caliente)
npm run dev
```

### Configuración del motor de voz (Opcional)

Roxy puede reproducir respuestas por voz mediante un modelo de conversión de voz RVC local:

```bash
# 1. Instalar dependencias de audio de Python, PyTorch CUDA y RVC
python script/setup_tts_env.py

# 2. Iniciar el demonio TTS RVC local (escucha en http://127.0.0.1:5050)
npm run tts:server
```

También puedes habilitar **Fish Audio API** en Configuración para síntesis de voz en la nube sin necesidad de GPU local.

## Scripts útiles

| Script                   | Descripción                                                                           |
| ------------------------ | ------------------------------------------------------------------------------------- |
| `npm run dev`            | Iniciar la aplicación de escritorio con recarga en caliente                           |
| `npm run build`          | Comprobar tipos y compilar main, preload y renderer                                   |
| `npm run typecheck`      | Comprobar tipos tanto para Node (`tsconfig.node.json`) como Web (`tsconfig.web.json`) |
| `npm run start`          | Previsualizar la compilación de producción                                            |
| `npm run tts:server`     | Iniciar el servidor de voz Python RVC TTS local                                       |
| `npm run smoke`          | Ejecutar la suite completa de pruebas de humo (shared, i18n, store, multirepo, app)   |
| `npm run smoke:shared`   | Ejecutar pruebas de humo rápidas en Node para módulos compartidos                     |
| `npm run smoke:store`    | Verificar el esquema de la base de datos y los protectores de migración               |
| `npm run smoke:i18n`     | Validar los catálogos de traducción frente al esquema de `default.json`               |
| `npm run i18n`           | Notificar el estado de finalización de la traducción en los 10 idiomas                |
| `npm run i18n:sync`      | Sincronizar las claves de los catálogos de traducción con `default.json`              |
| `npm run i18n:translate` | Traducir claves faltantes usando OpenRouter                                           |
| `npm run format`         | Formatear código con Prettier                                                         |
| `npm run format:check`   | Comprobar formato del código                                                          |
| `npm run build:win`      | Compilar ejecutable / instalador para Windows                                         |
| `npm run build:mac`      | Compilar paquete de aplicación para macOS                                             |
| `npm run build:linux`    | Compilar paquetes de distribución para Linux (AppImage, deb)                          |

## Notas de arquitectura

- **El aislamiento de contexto está habilitado** y `nodeIntegration` está desactivado. El renderer solo se comunica con el proceso principal mediante el puente tipado `window.api` definido en [`src/preload`](src/preload/index.ts).
- Los manejadores de IPC residen en [`src/main/ipc`](src/main/ipc/index.ts). Añade una nueva funcionalidad para el renderer registrando un `ipcMain.handle(...)` allí y exponiendo el método correspondiente en el puente de precarga.

### Harness del agente

El proceso principal ejecuta un único bucle de agente independiente del proveedor; el renderer solo recibe eventos en streaming.

- **Bucle de herramientas** — [`src/main/harness/agent.ts`](src/main/harness/agent.ts) controla el bucle de turnos, los esquemas JSON de herramientas (`BASE_SCHEMAS`), el recorte de contexto y la delegación en subagentes. [`tools.ts`](src/main/harness/tools.ts) es el despachador oficial de `runTool`. El catálogo orientado a la interfaz en [`src/shared/tools.ts`](src/shared/tools.ts) lo refleja (la página «Skills & Tools») y está protegido contra desviaciones por la suite de pruebas de humo compartida.
- **Proveedores** — La ruta SSE personalizada de OpenAI/Copilot (con actualización de tokens de corta duración de Copilot) se encuentra en [`services/llm.ts`](src/main/services/llm.ts); Anthropic + Google se canalizan a través de Vercel AI SDK en [`services/aisdk.ts`](src/main/services/aisdk.ts) para que cada familia cuente con llamada a herramientas.
- **Prompts y agentes** — Los prompts adaptados a cada modelo se seleccionan en [`src/shared/prompt.ts`](src/shared/prompt.ts) y se insertan desde `resources/prompts/*.txt` mediante `?raw` en [`prompt-text.ts`](src/shared/prompt-text.ts). Los agentes Plan/Build y los subagentes se definen en [`src/shared/agents.ts`](src/shared/agents.ts); la lista de herramientas permitidas (`tools`) y el `promptFile` de un agente hacen que Plan sea auténticamente de solo lectura.
- **Gestión de contexto** — El desbordamiento se mide frente al límite real del modelo ([`src/shared/context.ts`](src/shared/context.ts)); las salidas grandes de herramientas se vuelcan a disco con un puntero de vista previa ([`services/tool-output-store.ts`](src/main/services/tool-output-store.ts)); los turnos antiguos son resumidos por [`services/compaction.ts`](src/main/services/compaction.ts).
- **Ecosistema** — Servidores de herramientas externos mediante el cliente MCP ([`services/mcp.ts`](src/main/services/mcp.ts)), diagnósticos de servidores de lenguaje reincorporados tras ediciones ([`services/lsp.ts`](src/main/services/lsp.ts)) y habilidades `SKILL.md` bajo demanda ([`services/skills.ts`](src/main/services/skills.ts)). Las herramientas de navegador persistente de Roxy ([`services/browser.ts`](src/main/services/browser.ts)) y los bucles programados periódicos ([`services/loops.ts`](src/main/services/loops.ts)) se ejecutan en el mismo bucle.

### IDE integrado y flujo de trabajo de Git

- **Editor de archivos y árbol** — [`src/renderer/src/components/FileEditor.tsx`](src/renderer/src/components/FileEditor.tsx) proporciona un editor integrado con resaltado de sintaxis impulsado por Shiki, pestañas de archivos activos y adjunto de contexto.
- **Acciones de Git y solucionador de conflictos** — [`src/renderer/src/components/GitActionsView.tsx`](src/renderer/src/components/GitActionsView.tsx) y [`MergeConflictSolver.tsx`](src/renderer/src/components/MergeConflictSolver.tsx) muestran el historial visual de ramas, cambios en staging, inspección de diferencias y resolución de conflictos de fusión a 3 vías.
- **Emulador de terminal** — Creado sobre `@xterm/xterm` y `node-pty`, con sesiones de shell gestionadas en [`src/main/services/shell-session.ts`](src/main/services/shell-session.ts) y [`src/renderer/src/components/TerminalView.tsx`](src/renderer/src/components/TerminalView.tsx).

### Compañera Live2D y síntesis de voz

- **Avatar Live2D** — Renderizado mediante Cubism Core en [`Live2dCanvas.tsx`](src/renderer/src/components/Live2dCanvas.tsx) y [`VtuberStandalone.tsx`](src/renderer/src/components/VtuberStandalone.tsx) con física interactiva, disparadores de expresiones y sincronización labial con audio.
- **Inferencia RVC v2** — El demonio local en Python [`script/rvc_tts_server.py`](script/rvc_tts_server.py) combina la generación edge-tts con conversión de tono y timbre por GPU local usando checkpoints en `RoxyMigurdia/`.
- **Voz a texto (STT)** — [`src/main/services/stt.ts`](src/main/services/stt.ts) captura instrucciones de voz y las transcribe localmente mediante faster-whisper ([`script/transcribe.py`](script/transcribe.py)).

### Espacio de trabajo remoto

Lleva una sesión en ejecución a tu teléfono. **Remote Workspace** (grupo **CUSTOMIZE** abajo a la izquierda en la barra lateral) crea una sala, muestra un código QR + URL segura + PIN y mantiene el escritorio como host principal mientras un teléfono actúa como cliente ligero — **tu código y archivos nunca salen de la máquina**; solo se transmiten la transcripción del chat y los eventos del agente.

- **Servicio de host** — [`main/services/remote.ts`](src/main/services/remote.ts) genera la sesión en la retransmisión (configurada mediante `ROXY_REMOTE_BASE`, por defecto `https://roxy.schvis.com`), conserva el **token de host** y mantiene una conexión WebSocket persistente. Ante un mensaje `hello` de un invitado, envía una instantánea del historial; ante un `prompt` de un invitado, ejecuta el turno localmente transmitiendo cada `LlmEvent` al teléfono y al renderer local en paralelo.
- **Un solo bucle, sin divergencias** — Tanto las llamadas IPC locales `llm:start` como los prompts remotos se ejecutan mediante `runSessionTurn` en [`main/services/session-turn.ts`](src/main/services/session-turn.ts).
- **Seguridad** — Autenticación sin inicio de sesión: se transfiere un token de invitado HMAC de corta duración en el fragmento de la URL y el teléfono debe ingresar el **PIN** de 6 dígitos mostrado en el escritorio. Las salas se revocan automáticamente al detenerse, tras repetidos intentos fallidos de PIN o al desconectarse el escritorio.

<a id="translations"></a>

## Traducciones

Roxy está disponible en English, 简体中文, हिन्दी, Español, العربية, Français, Português, Русский, Deutsch y 日本語. Los hablantes nativos pueden ayudarnos a hacer la interfaz más clara y natural. Aceptamos incidencias y descripciones de pull requests en cualquiera de estos idiomas.

- Los textos fuente en inglés están en [`src/renderer/src/locales/default.json`](src/renderer/src/locales/default.json).
- Los catálogos de traducción están en [`src/renderer/src/locales`](src/renderer/src/locales).
- Consulta la [guía de localización](AGENTS.md#user-facing-strings-live-in-defaultjson) antes de modificar textos de la interfaz o añadir un idioma.
- Ejecuta `npm run i18n` para validar la estructura de catálogos, marcadores de posición y marcado en línea.

## Licencia

[MIT](LICENSE) © Roxy.

Este proyecto es un fork de [Roxy](https://github.com/roxy-gg/roxy) que está basado en [opencode](https://github.com/sst/opencode) (también bajo MIT) y conserva sus avisos de derechos de autor junto con los de este proyecto. Consulta [LICENSE](LICENSE) y [`resources/prompts/ATTRIBUTION.txt`](resources/prompts/ATTRIBUTION.txt) para más detalles.
