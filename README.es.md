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

**Descarga:** [https://roxy.gg](https://roxy.gg)

Roxy es una aplicación [Electron](https://www.electronjs.org/) escrita en **TypeScript** con una interfaz en **React**. El proceso principal incluye un sistema de agentes completo: un bucle de herramientas independiente del proveedor, instrucciones optimizadas para cada modelo, agentes Plan/Build y subagentes, gestión de contexto respaldada en disco e integraciones con servidores MCP, diagnósticos de servidores de lenguaje y habilidades `SKILL.md`.

## Tecnologías

| Capa               | Tecnología                         |
| ------------------ | ---------------------------------- |
| Escritorio         | Electron 33                        |
| Compilación        | electron-vite (Vite 5)             |
| Interfaz           | React 18 + TypeScript              |
| Estilos            | Tailwind CSS v4                    |
| Herramientas de IA | Vercel AI SDK (Anthropic + Google) |
| Integraciones      | Model Context Protocol SDK         |
| Almacenamiento     | better-sqlite3                     |
| Empaquetado        | electron-builder                   |
| Formato            | Prettier                           |

## Estructura del proyecto

```text
roxy/
├── build/                  # Recursos de empaquetado: iconos y permisos
├── resources/              # Recursos estáticos incluidos con la aplicación
│   └── prompts/            # Instrucciones por modelo y agente
├── src/
│   ├── main/               # Proceso principal de Electron (Node.js)
│   │   ├── index.ts        # Ciclo de vida, ventanas e inicio de servicios
│   │   ├── harness/        # Bucle del agente y ejecución de herramientas
│   │   ├── services/       # LLM, MCP, LSP, habilidades, navegador y bucles
│   │   ├── db/             # Esquema, migraciones y repositorio de better-sqlite3
│   │   └── ipc/            # Conexión IPC entre la interfaz y los servicios
│   ├── preload/            # Puente seguro window.api
│   ├── renderer/           # Aplicación React (Chromium)
│   └── shared/             # Módulos compartidos entre procesos
├── test/                   # Pruebas de humo y validación
├── electron.vite.config.ts # Configuración de compilación
└── electron-builder.yml    # Configuración de distribución
```

## Primeros pasos

```bash
# Instalar dependencias
npm install

# Ejecutar en desarrollo con recarga automática
npm run dev
```

## Scripts útiles

| Script                | Descripción                                             |
| --------------------- | ------------------------------------------------------- |
| `npm run dev`         | Inicia la aplicación con recarga automática             |
| `npm run build`       | Comprueba los tipos y crea la compilación de producción |
| `npm run typecheck`   | Comprueba los tipos de main, preload y renderer         |
| `npm run smoke`       | Ejecuta las pruebas compartidas y de Electron           |
| `npm run format`      | Formatea el repositorio con Prettier                    |
| `npm run build:win`   | Crea el instalador para Windows                         |
| `npm run build:mac`   | Crea la aplicación para macOS                           |
| `npm run build:linux` | Crea paquetes para Linux (AppImage y deb)               |

## Notas de arquitectura

- El aislamiento de contexto está activado y `nodeIntegration` está deshabilitado. La interfaz solo se comunica con el proceso principal mediante el puente tipado `window.api` definido en [`src/preload`](src/preload/index.ts).
- Los controladores IPC se encuentran en [`src/main/ipc`](src/main/ipc/index.ts). Las nuevas funciones para la interfaz deben registrar un `ipcMain.handle(...)` y exponer el método correspondiente en el puente de precarga.

### Sistema de agentes

El proceso principal ejecuta un único bucle de agente independiente del proveedor; la interfaz se limita a recibir los eventos transmitidos.

- **Bucle de herramientas:** [`src/main/harness/agent.ts`](src/main/harness/agent.ts) controla los turnos, los esquemas `BASE_SCHEMAS`, el recorte de contexto y los subagentes. [`tools.ts`](src/main/harness/tools.ts) contiene el despachador `runTool`.
- **Proveedores:** la integración SSE de OpenAI/Copilot está en [`services/llm.ts`](src/main/services/llm.ts). Anthropic y Google utilizan Vercel AI SDK desde [`services/aisdk.ts`](src/main/services/aisdk.ts).
- **Instrucciones y agentes:** [`src/shared/prompt.ts`](src/shared/prompt.ts) selecciona las instrucciones por modelo. Los agentes Plan/Build y los subagentes se definen en [`src/shared/agents.ts`](src/shared/agents.ts).
- **Gestión de contexto:** [`src/shared/context.ts`](src/shared/context.ts) mide el límite real de cada modelo; las salidas grandes se guardan en disco y los turnos antiguos se compactan.
- **Ecosistema:** MCP, diagnósticos LSP, habilidades `SKILL.md`, el navegador persistente y los bucles recurrentes usan el mismo sistema de agentes.

### Espacio de trabajo remoto

Lleva una sesión activa a tu teléfono. **Remote Workspace** crea una sala en roxy.gg, muestra un código QR, una URL segura y un PIN, y mantiene el escritorio como host principal. **Tu código y tus archivos nunca salen del equipo**; solo se retransmiten la conversación y los eventos del agente.

- [`main/services/remote.ts`](src/main/services/remote.ts) crea la sesión con `POST https://roxy.gg/api/remote/sessions`, conserva el token del host y mantiene la conexión WebSocket.
- Tanto las solicitudes locales como las remotas usan `runSessionTurn` en [`main/services/session-turn.ts`](src/main/services/session-turn.ts), por lo que su comportamiento es idéntico.
- La API IPC incluye `remote:start`, `remote:stop`, `remote:status` y los eventos `remote:state`. El cuadro del código QR está en [`renderer/src/components/RemoteWorkspaceDialog.tsx`](src/renderer/src/components/RemoteWorkspaceDialog.tsx).
- La sala se revoca al dejar de compartir, tras demasiados PIN incorrectos, al caducar o poco después de que el escritorio se desconecte. Consulta el protocolo en el [README de roxy.gg](../roxy.gg/README.md#remote-workspace).

<a id="translations"></a>

## Traducciones

Roxy está disponible en English, 简体中文, हिन्दी, Español, العربية, Français, Português, Русский, Deutsch y 日本語. Los hablantes nativos pueden ayudarnos a conseguir una interfaz más clara y natural. Aceptamos incidencias y descripciones de pull requests en cualquiera de estos idiomas.

- Los textos fuente en inglés están en [`src/renderer/src/locales/default.json`](src/renderer/src/locales/default.json).
- Los catálogos traducidos están en [`src/renderer/src/locales`](src/renderer/src/locales).
- Consulta la [guía de localización](AGENTS.md#user-facing-strings-live-in-defaultjson) antes de modificar textos de la interfaz o añadir un idioma.
- Ejecuta `npm run i18n` para validar la estructura, los marcadores y el marcado integrado.

## Licencia

[MIT](LICENSE) © Roxy.

Roxy es un fork de [opencode](https://github.com/sst/opencode), también publicado bajo MIT, y conserva sus avisos de copyright junto con los propios. Consulta [LICENSE](LICENSE) y [`resources/prompts/ATTRIBUTION.txt`](resources/prompts/ATTRIBUTION.txt) para más información.
