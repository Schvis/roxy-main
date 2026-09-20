<p align="center">
  <a href="https://roxy.gg">
    <img src="roxy.png" alt="Roxy" width="640" />
  </a>
</p>

<p align="center">
  <strong>语言：</strong>
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
  <a href="#translations">使用你的语言参与贡献</a>
</p>

# Roxy

> 面向工程师的开源 AI 编程代理，以跨平台桌面应用的形式构建。

本项目是 [Roxy](https://github.com/roxy-gg/roxy) 的分支，基于 [opencode](https://github.com/sst/opencode)。

**下载：** [https://roxy.gg](https://roxy.gg)

Roxy 是一款使用 **TypeScript** 编写、采用 **React** 界面的 [Electron](https://www.electronjs.org/) 应用。主进程中内置完整的代理**框架**（harness）：与模型提供商无关的工具调用循环、针对不同模型优化的系统提示、Plan/Build 代理与子代理、基于磁盘的上下文管理，以及 MCP 服务器、语言服务器诊断和 `SKILL.md` 技能等集成。

除了代理循环外，Roxy 还集成了具备 Git 冲突解决功能的内置 IDE、支持本地 GPU 加速 RVC 语音合成的交互式 Live2D 伴侣、用于移动端控制的自托管远程工作区中继服务器、定时自主循环以及原生终端。

## 核心特性

- **代理框架** — 与模型提供商无关的工具执行循环，支持 Plan（只读）和 Build 模式、子代理委派、自动化上下文压缩以及大体积工具输出的磁盘溢出存储。
- **多提供商与自定义端点** — 原生支持 OpenAI、Copilot（支持自动令牌刷新）、Anthropic、通过 Vercel AI SDK 支持的 Google Gemini、本地模型以及自定义图像生成端点。
- **集成 IDE 与 Git 操作** — 内置代码编辑器，支持语法高亮（Shiki）、行差异标记、可视化合并冲突解决器、交互式 Git 提交图和多仓库工作区管理。
- **内嵌终端** — 基于 `@xterm/xterm` 和 `node-pty` 的硬件加速终端模拟器，支持持久 Shell 会话、独立弹出窗口及命令历史。
- **Live2D 伴侣与语音合成** — 交互式洛琪希·米格路迪亚（Roxy Migurdia）Live2D 形象，带有动画表情与互动反应（摸头/胸口互动），结合离线 GPU 加速的 RVC（Retrieval-based Voice Conversion）v2 TTS、faster-whisper STT 语音输入或 Fish Audio 云端语音。
- **远程工作区与移动端中继** — 通过二维码和 PIN 码与手机或平板配对，无需通过第三方中转代码；默认连接至 `https://roxy.schvis.com`（可通过 `ROXY_REMOTE_BASE` 配置），并支持在 `remote-server/` 中独立自托管 Next.js App Router 中继服务器（未提交 / 被 git 忽略）。
- **生态与扩展能力** — Model Context Protocol (MCP) 客户端 + Windows MCP、语言服务器协议 (LSP) 诊断反馈、`SKILL.md` 技能运行器、持久 Chromium 浏览器自动化以及 Discord Rich Presence。
- **完整国际化** — 涵盖 10 种语言（阿拉伯语、德语、英语、西班牙语、法语、印地语、日语、葡萄牙语、俄语、中文）的完整界面本地化，并通过自动化工具保持同步。

## 技术栈

| 层级               | 技术选型                                                     |
| ------------------ | ------------------------------------------------------------ |
| 桌面应用           | Electron 33                                                  |
| 构建工具           | electron-vite (Vite 5)                                       |
| 界面               | React 18 + TypeScript                                        |
| 样式               | Tailwind CSS v4                                              |
| 工具调用与模型     | Vercel AI SDK (Anthropic, Google) + 原生 OpenAI, Copilot SSE |
| 终端               | @xterm/xterm 6 + node-pty                                    |
| 代码与 Diff 查看器 | Shiki + diff                                                 |
| 集成               | Model Context Protocol (MCP) SDK, LSP, Discord RPC           |
| 语音引擎           | 本地 RVC v2 (PyTorch/CUDA) + faster-whisper + Fish Audio API |
| 伴侣               | Live2D Cubism Core                                           |
| 存储               | better-sqlite3                                               |
| 打包               | electron-builder                                             |
| 本地化             | i18next + react-i18next (10 种语言)                          |
| 格式化             | Prettier                                                     |

## 项目结构

```
roxy/
├── build/                  # 打包资源（图标、entitlements）
├── remote-server/          # 独立 Next.js 中继与移动端客户端（git 忽略，不在仓库提交中）
├── resources/              # 随应用打包的静态资源
│   ├── models/live2d/      # Live2D Cubism 伴侣形象资源
│   ├── prompts/            # 针对模型和代理优化的系统提示（通过 ?raw 内联）
│   └── voicelines/         # 交互式伴侣语音音频触发文件
├── RoxyMigurdia/           # RVC 语音模型权重 (.pth) 与特征索引 (.index)
├── script/                 # 配置脚本、TTS/STT 后台进程、i18n 翻译与打包
│   ├── rvc_tts_server.py   # 本地 GPU RVC TTS 推理后台服务（端口 5050）
│   ├── setup_tts_env.py    # 自动化 Python 环境及 CUDA 依赖安装程序
│   ├── transcribe.py       # faster-whisper STT 语音识别运行器
│   ├── i18n-sync.mjs       # default.json 的语言目录同步器
│   └── i18n-translate.mjs  # 基于 OpenRouter 的机器翻译运行器
├── src/
│   ├── main/               # Electron 主进程 (Node.js)
│   │   ├── index.ts        # 应用生命周期、窗口创建、服务启动
│   │   ├── harness/        # 代理循环：agent.ts（轮次循环、工具模式）、tools.ts（分发）
│   │   ├── services/       # llm.ts, aisdk.ts, mcp.ts, lsp.ts, tts.ts, stt.ts, browser.ts, remote.ts, …
│   │   ├── db/             # better-sqlite3 存储：架构、迁移、仓库层
│   │   └── ipc/            # 连接渲染进程与框架/服务的 ipcMain 处理器
│   ├── preload/            # 主进程与渲染进程之间的安全桥接层 (window.api)
│   ├── renderer/           # React 应用 (Chromium)：路由、组件、存储
│   │   └── src/
│   │       ├── components/ # ChatView, FileEditor, GitActionsView, Live2dCanvas, McpServers, …
│   │       └── locales/    # 作为单一事实来源的 default.json 及 10 种语言目录
│   └── shared/             # 跨进程纯模块：tools, agents, prompt/prompt-text,
│                           #   providers, context, tool-history, mcp, lsp, skills, types
├── test/                   # 冒烟测试套件（Electron 应用、共享 Node、存储、i18n、画布）
├── electron.vite.config.ts # 主进程 / preload / 渲染进程构建配置
└── electron-builder.yml    # 分发打包配置
```

## 快速开始

### 前置要求

- **Node.js** >= 20
- **Python** >= 3.10（可选，本地 RVC 语音合成和本地 STT 所需）
- **配备 CUDA 的 NVIDIA GPU**（推荐用于本地声音转换；亦支持 CPU 模式）

### 安装并运行桌面应用

```bash
# 安装依赖
npm install

# 以热重载方式启动开发环境
npm run dev
```

### 语音引擎配置（可选）

Roxy 可以使用本地 RVC 声音转换模型朗读回复：

```bash
# 1. 安装 Python 音频依赖、PyTorch CUDA 和 RVC
python script/setup_tts_env.py

# 2. 启动本地 RVC TTS 后台服务（监听 http://127.0.0.1:5050）
npm run tts:server
```

你也可以在“设置”中启用 **Fish Audio API** 进行云端语音合成，无需本地 GPU。

## 常用脚本

| 脚本                     | 说明                                                                         |
| ------------------------ | ---------------------------------------------------------------------------- |
| `npm run dev`            | 以热重载方式启动桌面应用                                                     |
| `npm run build`          | 检查类型并编译主进程、preload 和渲染进程                                     |
| `npm run typecheck`      | 同时对 Node (`tsconfig.node.json`) 和 Web (`tsconfig.web.json`) 进行类型检查 |
| `npm run start`          | 预览生产构建                                                                 |
| `npm run tts:server`     | 启动本地 RVC TTS Python 语音服务                                             |
| `npm run smoke`          | 运行完整冒烟测试套件（shared, i18n, store, multirepo, app）                  |
| `npm run smoke:shared`   | 运行纯 Node 共享模块的快速冒烟测试                                           |
| `npm run smoke:store`    | 验证数据库架构与迁移守卫                                                     |
| `npm run smoke:i18n`     | 对照 `default.json` 架构验证翻译目录                                         |
| `npm run i18n`           | 汇报全部 10 种语言的翻译完成状态                                             |
| `npm run i18n:sync`      | 同步翻译目录的键与 `default.json` 一致                                       |
| `npm run i18n:translate` | 使用 OpenRouter 翻译缺失的键                                                 |
| `npm run format`         | 使用 Prettier 格式化代码                                                     |
| `npm run format:check`   | 检查代码格式                                                                 |
| `npm run build:win`      | 构建 Windows 可执行程序 / 安装包                                             |
| `npm run build:mac`      | 构建 macOS 应用程序包                                                        |
| `npm run build:linux`    | 构建 Linux 分发软件包 (AppImage, deb)                                        |

## 架构说明

- **已启用上下文隔离**并关闭 `nodeIntegration`。渲染进程只能通过 [`src/preload`](src/preload/index.ts) 中定义的类型化 `window.api` 桥接层与主进程通信。
- IPC 处理器位于 [`src/main/ipc`](src/main/ipc/index.ts)。若要添加面向渲染进程的新功能，请在此注册 `ipcMain.handle(...)`，并在 preload 桥接层中暴露对应方法。

### 代理框架

主进程运行一个与模型提供商无关的独立代理循环；渲染进程仅接收流式事件。

- **工具循环** — [`src/main/harness/agent.ts`](src/main/harness/agent.ts) 掌管对话轮次循环、工具 JSON Schema（`BASE_SCHEMAS`）、上下文裁剪以及子代理分发。[`tools.ts`](src/main/harness/tools.ts) 是权威的 `runTool` 分发器。[`src/shared/tools.ts`](src/shared/tools.ts) 中的用户界面目录与其镜像对应（“技能与工具”页面），并通过共享冒烟测试套件防止偏离。
- **模型提供商** — 自研的 OpenAI/Copilot SSE 路径（带 Copilot 短效令牌自动刷新）位于 [`services/llm.ts`](src/main/services/llm.ts)；Anthropic 与 Google 通过 [`services/aisdk.ts`](src/main/services/aisdk.ts) 接入 Vercel AI SDK，使所有模型系列均获得工具调用能力。
- **提示与代理** — 针对模型优化的提示在 [`src/shared/prompt.ts`](src/shared/prompt.ts) 中选择，并通过 `?raw` 从 `resources/prompts/*.txt` 内联到 [`prompt-text.ts`](src/shared/prompt-text.ts)。Plan/Build 代理与子代理定义在 [`src/shared/agents.ts`](src/shared/agents.ts) 中；代理的 `tools` 白名单与 `promptFile` 确保了 Plan 模式真正的只读特性。
- **上下文管理** — 根据模型的真实上限计算容量溢出（[`src/shared/context.ts`](src/shared/context.ts)）；大体积工具输出会溢出存储到磁盘并附带预览指针（[`services/tool-output-store.ts`](src/main/services/tool-output-store.ts)）；较早轮次由 [`services/compaction.ts`](src/main/services/compaction.ts) 进行总结压缩。
- **生态系统** — 通过 MCP 客户端接入外部工具服务器（[`services/mcp.ts`](src/main/services/mcp.ts)）、编辑后反馈语言服务器诊断（[`services/lsp.ts`](src/main/services/lsp.ts)）以及按需加载 `SKILL.md` 技能（[`services/skills.ts`](src/main/services/skills.ts)）。Roxy 的持久浏览器工具集（[`services/browser.ts`](src/main/services/browser.ts)）和定时循环（[`services/loops.ts`](src/main/services/loops.ts)）均在此同一循环中运行。

### 集成 IDE 与 Git 工作流

- **文件编辑器与文件树** — [`src/renderer/src/components/FileEditor.tsx`](src/renderer/src/components/FileEditor.tsx) 提供应用内编辑器，采用 Shiki 提供语法高亮，支持活动文件标签页和上下文附件。
- **Git 操作与冲突解决器** — [`src/renderer/src/components/GitActionsView.tsx`](src/renderer/src/components/GitActionsView.tsx) 和 [`MergeConflictSolver.tsx`](src/renderer/src/components/MergeConflictSolver.tsx) 呈现可视化分支历史、暂存更改、差异检查以及三方合并冲突解决。
- **终端模拟器** — 基于 `@xterm/xterm` 和 `node-pty` 构建，Shell 会话由 [`src/main/services/shell-session.ts`](src/main/services/shell-session.ts) 和 [`src/renderer/src/components/TerminalView.tsx`](src/renderer/src/components/TerminalView.tsx) 管理。

### Live2D 伴侣与语音合成

- **Live2D 形象** — 在 [`Live2dCanvas.tsx`](src/renderer/src/components/Live2dCanvas.tsx) 和 [`VtuberStandalone.tsx`](src/renderer/src/components/VtuberStandalone.tsx) 中通过 Cubism Core 渲染，具备可交互物理效果、表情触发和音频对口型。
- **RVC v2 推理** — 本地 Python 后台服务 [`script/rvc_tts_server.py`](script/rvc_tts_server.py) 将 edge-tts 生成与使用 `RoxyMigurdia/` 中权重的本地 GPU 音高/音色转换相结合。
- **语音转文字** — [`src/main/services/stt.ts`](src/main/services/stt.ts) 捕获语音输入，并使用 faster-whisper（[`script/transcribe.py`](script/transcribe.py)）在本地转写。

### 远程工作区

将正在运行的会话转移至手机上。**Remote Workspace**（侧边栏左下角 **CUSTOMIZE** 分组）生成房间，显示二维码 + 安全 URL + PIN 码，并让桌面端作为权威主机，手机作为瘦客户端进行操控 — **你的代码和文件永远不会离开本机**；仅转发聊天记录和流式代理事件。

- **主机服务** — [`main/services/remote.ts`](src/main/services/remote.ts) 在中继服务器（通过 `ROXY_REMOTE_BASE` 配置，默认 `https://roxy.schvis.com`）上创建会话，持有**主机令牌**，并保持持久 WebSocket 连接。当访客发送 `hello` 时发送历史记录快照；当访客发送 `prompt` 时在本地执行轮次，同时将每个 `LlmEvent` 流式传输至手机和本地渲染进程。
- **单一循环，杜绝分歧** — 本地 `llm:start` IPC 调用与远程提示均通过 [`main/services/session-turn.ts`](src/main/services/session-turn.ts) 的 `runSessionTurn` 执行。
- **安全机制** — 零登录认证：通过 URL fragment 传递短效 HMAC 访客令牌，手机端必须提供桌面端显示的 6 位 **PIN 码**。停止共享、多次输入错误 PIN 码或桌面断开连接后，房间将自动注销。

<a id="translations"></a>

## 翻译

Roxy 支持 English、简体中文、हिन्दी、Español、العربية、Français、Português、Русский、Deutsch 和 日本語。母语使用者可以帮助我们让界面表达更加清晰自然。欢迎使用上述任何语言提交 issue 或编写 pull request 说明。

- 英文源文本位于 [`src/renderer/src/locales/default.json`](src/renderer/src/locales/default.json)。
- 翻译目录位于 [`src/renderer/src/locales`](src/renderer/src/locales)。
- 修改界面文本或添加新语言前，请阅读[本地化指南](AGENTS.md#user-facing-strings-live-in-defaultjson)。
- 运行 `npm run i18n` 以验证目录结构、占位符和内联标记。

## 许可证

[MIT](LICENSE) © Roxy.

本项目是 [Roxy](https://github.com/roxy-gg/roxy) 的分支，基于 [opencode](https://github.com/sst/opencode)（同样采用 MIT 许可证），并在保留自身版权信息的同时保留其版权。详情请参阅 [LICENSE](LICENSE) 和 [`resources/prompts/ATTRIBUTION.txt`](resources/prompts/ATTRIBUTION.txt)。
