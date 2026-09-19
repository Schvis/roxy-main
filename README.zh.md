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

**下载：** [https://roxy.gg](https://roxy.gg)

Roxy 是一款使用 **TypeScript** 编写、采用 **React** 界面的 [Electron](https://www.electronjs.org/) 应用。主进程中包含完整的代理系统：与模型提供商无关的工具调用循环、针对不同模型优化的系统提示、Plan/Build 代理与子代理、基于磁盘的上下文管理，以及 MCP 服务器、语言服务器诊断和 `SKILL.md` 技能等集成。

## 技术栈

| 层级     | 技术选型                           |
| -------- | ---------------------------------- |
| 桌面应用 | Electron 33                        |
| 构建工具 | electron-vite (Vite 5)             |
| 界面     | React 18 + TypeScript              |
| 样式     | Tailwind CSS v4                    |
| 工具调用 | Vercel AI SDK (Anthropic + Google) |
| 集成     | Model Context Protocol SDK         |
| 存储     | better-sqlite3                     |
| 打包     | electron-builder                   |
| 格式化   | Prettier                           |

## 项目结构

```text
roxy/
├── build/                  # 图标、权限等打包资源
├── resources/              # 随应用发布的静态资源
│   └── prompts/            # 针对模型和代理优化的提示
├── src/
│   ├── main/               # Electron 主进程 (Node.js)
│   │   ├── index.ts        # 应用生命周期、窗口和服务启动
│   │   ├── harness/        # 代理循环和工具执行
│   │   ├── services/       # LLM、MCP、LSP、技能、浏览器和循环任务
│   │   ├── db/             # better-sqlite3 架构、迁移和仓库
│   │   └── ipc/            # 界面与服务之间的 IPC 连接
│   ├── preload/            # 安全的 window.api 桥接层
│   ├── renderer/           # React 应用 (Chromium)
│   └── shared/             # 跨进程共享模块
├── test/                   # 冒烟测试和验证测试
├── electron.vite.config.ts # 构建配置
└── electron-builder.yml    # 发布配置
```

## 快速开始

```bash
# 安装依赖
npm install

# 以热重载方式启动开发环境
npm run dev
```

## 常用脚本

| 脚本                  | 说明                                  |
| --------------------- | ------------------------------------- |
| `npm run dev`         | 启动带热重载的应用                    |
| `npm run build`       | 检查类型并构建生产版本                |
| `npm run typecheck`   | 检查 main、preload 和 renderer 的类型 |
| `npm run smoke`       | 运行共享测试和 Electron 测试          |
| `npm run format`      | 使用 Prettier 格式化代码库            |
| `npm run build:win`   | 构建 Windows 安装程序                 |
| `npm run build:mac`   | 构建 macOS 应用                       |
| `npm run build:linux` | 构建 Linux 软件包 (AppImage、deb)     |

## 架构说明

- 已启用上下文隔离并关闭 `nodeIntegration`。界面只能通过 [`src/preload`](src/preload/index.ts) 中定义的类型安全 `window.api` 桥接层与主进程通信。
- IPC 处理器位于 [`src/main/ipc`](src/main/ipc/index.ts)。面向界面的新功能应在此注册 `ipcMain.handle(...)`，并在 preload 桥接层公开对应方法。

### 代理系统

主进程运行一个与模型提供商无关的代理循环；界面只负责接收流式事件。

- **工具循环：** [`src/main/harness/agent.ts`](src/main/harness/agent.ts) 管理对话轮次、`BASE_SCHEMAS`、上下文裁剪和子代理。[`tools.ts`](src/main/harness/tools.ts) 包含权威的 `runTool` 分发器。
- **模型提供商：** OpenAI/Copilot 的 SSE 集成位于 [`services/llm.ts`](src/main/services/llm.ts)。Anthropic 和 Google 通过 [`services/aisdk.ts`](src/main/services/aisdk.ts) 使用 Vercel AI SDK。
- **提示与代理：** [`src/shared/prompt.ts`](src/shared/prompt.ts) 负责选择模型提示。Plan/Build 代理和子代理定义在 [`src/shared/agents.ts`](src/shared/agents.ts) 中。
- **上下文管理：** [`src/shared/context.ts`](src/shared/context.ts) 根据模型的真实上限计算容量；大型输出会写入磁盘，较早的轮次会被压缩。
- **生态集成：** MCP、LSP 诊断、`SKILL.md` 技能、持久浏览器和定时循环都使用同一套代理系统。

### 远程工作区

你可以在手机上继续操作正在运行的会话。**Remote Workspace** 会在 roxy.gg 上创建房间，显示二维码、安全 URL 和 PIN，并让桌面端继续作为主机。**你的代码和文件永远不会离开本机**；传输的只有聊天内容和代理事件。

- [`main/services/remote.ts`](src/main/services/remote.ts) 通过 `POST https://roxy.gg/api/remote/sessions` 创建会话，保管主机令牌并维持 WebSocket 连接。
- 本地和远程请求都调用 [`main/services/session-turn.ts`](src/main/services/session-turn.ts) 中的 `runSessionTurn`，因此行为一致。
- IPC API 包含 `remote:start`、`remote:stop`、`remote:status` 和 `remote:state` 事件。二维码对话框位于 [`renderer/src/components/RemoteWorkspaceDialog.tsx`](src/renderer/src/components/RemoteWorkspaceDialog.tsx)。
- 停止共享、连续输入过多错误 PIN、会话到期或桌面断开连接后，房间会被撤销。协议详情请参阅 [roxy.gg README](../roxy.gg/README.md#remote-workspace)。

<a id="translations"></a>

## 翻译

Roxy 支持 English、简体中文、हिन्दी、Español、العربية、Français、Português、Русский、Deutsch 和 日本語。母语使用者可以帮助我们让界面表达更加清晰自然。欢迎使用上述任何语言提交 issue 或编写 pull request 说明。

- 英文源文本位于 [`src/renderer/src/locales/default.json`](src/renderer/src/locales/default.json)。
- 翻译目录位于 [`src/renderer/src/locales`](src/renderer/src/locales)。
- 修改界面文本或添加新语言前，请阅读[本地化指南](AGENTS.md#user-facing-strings-live-in-defaultjson)。
- 运行 `npm run i18n` 以验证目录结构、占位符和内联标记。

## 许可证

[MIT](LICENSE) © Roxy.

Roxy 是 [opencode](https://github.com/sst/opencode) 的分支；后者同样采用 MIT 许可证。Roxy 在保留自身版权信息的同时，也保留 opencode 的版权信息。详情请参阅 [LICENSE](LICENSE) 和 [`resources/prompts/ATTRIBUTION.txt`](resources/prompts/ATTRIBUTION.txt)。
