<p align="center">
  <a href="https://roxy.gg">
    <img src="roxy.png" alt="Roxy" width="640" />
  </a>
</p>

<p align="center">
  <strong>言語:</strong>
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
  <a href="#translations">あなたの言語で貢献する</a>
</p>

# Roxy

> エンジニア向けのオープンソース AI コーディングエージェント。クロスプラットフォームのデスクトップアプリとして開発されています。

**ダウンロード:** [https://roxy.gg](https://roxy.gg)

Roxy は **TypeScript** で書かれ、**React** の画面を備えた [Electron](https://www.electronjs.org/) アプリケーションです。メインプロセスには、プロバイダーに依存しないツール実行ループ、モデル別に調整されたシステム指示、Plan/Build エージェントとサブエージェント、ディスクを利用したコンテキスト管理、MCP サーバー、Language Server の診断、`SKILL.md` スキルを含む完全なエージェント基盤があります。

## 技術スタック

| レイヤー       | 採用技術                           |
| -------------- | ---------------------------------- |
| デスクトップ   | Electron 33                        |
| ビルド         | electron-vite (Vite 5)             |
| UI             | React 18 + TypeScript              |
| スタイル       | Tailwind CSS v4                    |
| ツール実行     | Vercel AI SDK (Anthropic + Google) |
| 連携           | Model Context Protocol SDK         |
| ストレージ     | better-sqlite3                     |
| パッケージング | electron-builder                   |
| フォーマット   | Prettier                           |

## プロジェクト構成

```text
roxy/
├── build/                  # アイコンや権限などのパッケージング用リソース
├── resources/              # アプリに同梱する静的リソース
│   └── prompts/            # モデルおよびエージェント別の指示
├── src/
│   ├── main/               # Electron メインプロセス (Node.js)
│   │   ├── index.ts        # アプリのライフサイクル、ウィンドウ、サービス起動
│   │   ├── harness/        # エージェントループとツール実行
│   │   ├── services/       # LLM、MCP、LSP、スキル、ブラウザー、ループ
│   │   ├── db/             # better-sqlite3 のスキーマ、移行、リポジトリ
│   │   └── ipc/            # UI とサービスを接続する IPC
│   ├── preload/            # 安全な window.api ブリッジ
│   ├── renderer/           # React アプリ (Chromium)
│   └── shared/             # プロセス間で共有するモジュール
├── test/                   # スモークテストと検証テスト
├── electron.vite.config.ts # ビルド設定
└── electron-builder.yml    # 配布設定
```

## はじめに

```bash
# 依存関係をインストール
npm install

# ホットリロード付きの開発モードで起動
npm run dev
```

## 主なスクリプト

| スクリプト            | 説明                                          |
| --------------------- | --------------------------------------------- |
| `npm run dev`         | ホットリロード付きでアプリを起動します        |
| `npm run build`       | 型を検査し、本番用ビルドを作成します          |
| `npm run typecheck`   | main、preload、renderer の型を検査します      |
| `npm run smoke`       | 共有テストと Electron テストを実行します      |
| `npm run format`      | Prettier でリポジトリを整形します             |
| `npm run build:win`   | Windows インストーラーを作成します            |
| `npm run build:mac`   | macOS アプリを作成します                      |
| `npm run build:linux` | Linux パッケージ (AppImage、deb) を作成します |

## アーキテクチャ

- コンテキスト分離は有効で、`nodeIntegration` は無効です。UI は [`src/preload`](src/preload/index.ts) で定義された型付きの `window.api` ブリッジを通してのみメインプロセスと通信します。
- IPC ハンドラーは [`src/main/ipc`](src/main/ipc/index.ts) にあります。UI 向け機能を追加する場合は、ここで `ipcMain.handle(...)` を登録し、preload ブリッジに対応するメソッドを公開します。

### エージェント基盤

メインプロセスは、プロバイダーに依存しない単一のエージェントループを実行します。UI はストリーミングされるイベントだけを受け取ります。

- **ツールループ:** [`src/main/harness/agent.ts`](src/main/harness/agent.ts) がターン、`BASE_SCHEMAS`、コンテキストの削減、サブエージェントを管理します。[`tools.ts`](src/main/harness/tools.ts) が正式な `runTool` ディスパッチャーです。
- **プロバイダー:** OpenAI/Copilot の SSE 連携は [`services/llm.ts`](src/main/services/llm.ts) にあります。Anthropic と Google は [`services/aisdk.ts`](src/main/services/aisdk.ts) から Vercel AI SDK を使用します。
- **指示とエージェント:** [`src/shared/prompt.ts`](src/shared/prompt.ts) がモデル別の指示を選択します。Plan/Build エージェントとサブエージェントは [`src/shared/agents.ts`](src/shared/agents.ts) で定義されています。
- **コンテキスト管理:** [`src/shared/context.ts`](src/shared/context.ts) が各モデルの実際の上限を扱います。大きな出力はディスクに保存され、古いターンは圧縮されます。
- **エコシステム:** MCP、LSP 診断、`SKILL.md` スキル、永続ブラウザー、定期実行ループは同じエージェント基盤を使用します。

### リモートワークスペース

実行中のセッションをスマートフォンから操作できます。**Remote Workspace** は roxy.gg にルームを作成し、QR コード、安全な URL、PIN を表示します。デスクトップは引き続き正式なホストです。**コードやファイルが端末の外へ送られることはありません**。転送されるのは会話とエージェントイベントだけです。

- [`main/services/remote.ts`](src/main/services/remote.ts) が `POST https://roxy.gg/api/remote/sessions` でセッションを作成し、ホストトークンを保持して WebSocket 接続を維持します。
- ローカルとリモートのリクエストはどちらも [`main/services/session-turn.ts`](src/main/services/session-turn.ts) の `runSessionTurn` を使うため、同じ動作になります。
- IPC API には `remote:start`、`remote:stop`、`remote:status`、`remote:state` イベントがあります。QR コードのダイアログは [`renderer/src/components/RemoteWorkspaceDialog.tsx`](src/renderer/src/components/RemoteWorkspaceDialog.tsx) にあります。
- 共有停止、PIN の連続失敗、有効期限、またはデスクトップ切断後にルームは無効化されます。プロトコルの詳細は [roxy.gg README](../roxy.gg/README.md#remote-workspace) を参照してください。

<a id="translations"></a>

## 翻訳

Roxy は English、简体中文、हिन्दी、Español、العربية、Français、Português、Русский、Deutsch、日本語に対応しています。ネイティブスピーカーの協力によって、より明確で自然な UI にできます。Issue や pull request の説明は、これらのどの言語で書いても構いません。

- 英語の原文は [`src/renderer/src/locales/default.json`](src/renderer/src/locales/default.json) にあります。
- 翻訳カタログは [`src/renderer/src/locales`](src/renderer/src/locales) にあります。
- UI テキストの編集や言語の追加を行う前に、[ローカライズガイド](AGENTS.md#user-facing-strings-live-in-defaultjson) を確認してください。
- `npm run i18n` を実行して、構造、プレースホルダー、インラインマークアップを検証してください。

## ライセンス

[MIT](LICENSE) © Roxy.

Roxy は MIT ライセンスの [opencode](https://github.com/sst/opencode) をフォークしたもので、Roxy 独自の著作権表示に加えて opencode の著作権表示も保持しています。詳細は [LICENSE](LICENSE) と [`resources/prompts/ATTRIBUTION.txt`](resources/prompts/ATTRIBUTION.txt) を参照してください。
