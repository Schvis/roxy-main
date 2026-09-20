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

このプロジェクトは [opencode](https://github.com/sst/opencode) をベースにした [Roxy](https://github.com/roxy-gg/roxy) のフォークです。

**ダウンロード:** [https://roxy.gg](https://roxy.gg)

Roxy は **TypeScript** で書かれ、**React** の画面を備えた [Electron](https://www.electronjs.org/) アプリケーションです。メインプロセスには、プロバイダーに依存しないツール実行ループ、モデル別に調整されたシステムプロンプト、Plan/Build エージェントとサブエージェント、ディスクを利用したコンテキスト管理、MCP サーバー、Language Server の診断、`SKILL.md` スキルを含む完全なエージェント**基盤**（harness）が備わっています。

エージェントループに加え、Git のコンフリクト解消機能を備えた内蔵 IDE、ローカル GPU 加速による RVC 音声合成を備えたインタラクティブな Live2D パートナー、モバイル操作用のセルフホスト可能な Remote Workspace リレーサーバー、スケジュールされた自律ループ、ネイティブターミナルを統合しています。

## 主な機能

- **エージェント基盤** — Plan（読み取り専用）および Build モード、サブエージェント委譲、自動コンテキスト要約、大規模なツール出力のディスク退避を備えた、プロバイダーに依存しないツール実行ループ。
- **マルチプロバイダーとカスタムエンドポイント** — OpenAI、Copilot（自動トークンリフレッシュ対応）、Anthropic、Vercel AI SDK 経由の Google Gemini、ローカルモデル、カスタム画像生成エンドポイントのネイティブサポート。
- **内蔵 IDE と Git 操作** — シンタックスハイライト（Shiki）、行ごとの diff 装飾、ビジュアルなマージコンフリクト解決機能、インタラクティブな Git コミットグラフ、マルチリポジトリのワークスペース管理を備えた内蔵コードエディタ。
- **内蔵ターミナル** — `@xterm/xterm` と `node-pty` によるハードウェアアクセラレーション対応ターミナルエミュレーター。永続シェルセッション、独立ポップアウト、コマンド履歴をサポート。
- **Live2D パートナーと音声合成** — アニメーション表情やリアクション（頭なで／胸タッチ反応）を備えたロキシー・ミグルディアのインタラクティブな Live2D アバター。オフライン GPU 加速 RVC (Retrieval-based Voice Conversion) v2 TTS、faster-whisper STT 音声入力、または Fish Audio クラウド音声を連携。
- **リモートワークスペースとモバイル中継** — サードパーティを介さずに QR コードと PIN でスマートフォンやタブレットとペアリング可能。デフォルトは `https://roxy.schvis.com`（`ROXY_REMOTE_BASE` で変更可能）、`remote-server/` 内のスタンドアロンなセルフホスト Next.js App Router リレーサーバーもサポート（未コミット／git-ignore 対象）。
- **エコシステムと拡張性** — Model Context Protocol (MCP) クライアント + Windows MCP、Language Server Protocol (LSP) 診断フィードバック、`SKILL.md` スキルランナー、永続 Chromium ブラウザ自動化、Discord Rich Presence。
- **完全な多言語対応** — 10 言語（アラビア語、ドイツ語、英語、スペイン語、フランス語、ヒンディー語、日本語、ポルトガル語、ロシア語、中国語）にわたる完全な UI ローカライゼーションを自動化ツールで同期。

## 技術スタック

| レイヤー           | 採用技術                                                           |
| ------------------ | ------------------------------------------------------------------ |
| デスクトップ       | Electron 33                                                        |
| ビルドツール       | electron-vite (Vite 5)                                             |
| UI                 | React 18 + TypeScript                                              |
| スタイリング       | Tailwind CSS v4                                                    |
| ツール実行とモデル | Vercel AI SDK (Anthropic, Google) + ネイティブ OpenAI, Copilot SSE |
| ターミナル         | @xterm/xterm 6 + node-pty                                          |
| コード & Diff      | Shiki + diff                                                       |
| 連携               | Model Context Protocol (MCP) SDK, LSP, Discord RPC                 |
| 音声エンジン       | ローカル RVC v2 (PyTorch/CUDA) + faster-whisper + Fish Audio API   |
| パートナー         | Live2D Cubism Core                                                 |
| ストレージ         | better-sqlite3                                                     |
| パッケージング     | electron-builder                                                   |
| 多言語対応         | i18next + react-i18next (10 言語)                                  |
| フォーマット       | Prettier                                                           |

## プロジェクト構成

```
roxy/
├── build/                  # パッケージング用リソース（アイコン、entitlements）
├── remote-server/          # スタンドアロン Next.js リレー & モバイルクライアント（git-ignore、リポジトリ非コミット）
├── resources/              # アプリに同梱する静的リソース
│   ├── models/live2d/      # Live2D Cubism パートナーアバター用リソース
│   ├── prompts/            # モデル・エージェント別に調整されたシステムプロンプト（?raw 経由インライン化）
│   └── voicelines/         # インタラクティブ音声トリガー用オーディオファイル
├── RoxyMigurdia/           # RVC 音声モデルチェックポイント (.pth) および特徴インデックス (.index)
├── script/                 # セットアップスクリプト、TTS/STT デーモン、i18n 翻訳・パッケージング
│   ├── rvc_tts_server.py   # ローカル GPU RVC TTS 推論デーモン（ポート 5050）
│   ├── setup_tts_env.py    # Python 環境および CUDA 依存関係の自動インストーラー
│   ├── transcribe.py       # faster-whisper STT 音声認識ランナー
│   ├── i18n-sync.mjs       # default.json 用カタログ同期ツール
│   └── i18n-translate.mjs  # OpenRouter を利用した機械翻訳ランナー
├── src/
│   ├── main/               # Electron メインプロセス (Node.js)
│   │   ├── index.ts        # アプリのライフサイクル、ウィンドウ作成、サービス起動
│   │   ├── harness/        # エージェントループ：agent.ts（ターンループ、ツールスキーマ）、tools.ts（ディスパッチ）
│   │   ├── services/       # llm.ts, aisdk.ts, mcp.ts, lsp.ts, tts.ts, stt.ts, browser.ts, remote.ts, …
│   │   ├── db/             # better-sqlite3 ストア：スキーマ、マイグレーション、リポジトリ層
│   │   └── ipc/            # レンダラーとハーネス／サービスを繋ぐ ipcMain ハンドラー
│   ├── preload/            # メインとレンダラー間の安全なブリッジ (window.api)
│   ├── renderer/           # React アプリ (Chromium)：ルーティング、コンポーネント、ストア
│   │   └── src/
│   │       ├── components/ # ChatView, FileEditor, GitActionsView, Live2dCanvas, McpServers, …
│   │       └── locales/    # ソースオブトゥルース default.json および 10 言語のカタログ
│   └── shared/             # プロセス間共有モジュール：tools, agents, prompt/prompt-text,
│                           #   providers, context, tool-history, mcp, lsp, skills, types
├── test/                   # スモークテストスイート（Electron アプリ、共有 Node、ストア、i18n、キャンバス）
├── electron.vite.config.ts # メイン / プリロード / レンダラーのビルド設定
└── electron-builder.yml    # 配布パッケージング設定
```

## はじめに

### 前提条件

- **Node.js** >= 20
- **Python** >= 3.10（任意、ローカル RVC 音声合成およびローカル STT に必要）
- **CUDA 対応 NVIDIA GPU**（ローカル音声変換に推奨、CPU モードも対応）

### デスクトップアプリのインストールと実行

```bash
# 依存関係をインストール
npm install

# ホットリロード付きの開発モードで起動
npm run dev
```

### 音声エンジンのセットアップ（任意）

Roxy はローカルの RVC 音声変換モデルを使って返答を読み上げることができます:

```bash
# 1. Python オーディオ依存関係、PyTorch CUDA、RVC のインストール
python script/setup_tts_env.py

# 2. ローカル RVC TTS デーモンの起動 (http://127.0.0.1:5050 で待機)
npm run tts:server
```

また、ローカル GPU を使わずにクラウド音声合成を利用したい場合は、設定から **Fish Audio API** を有効にすることもできます。

## 主なスクリプト

| スクリプト               | 説明                                                                          |
| ------------------------ | ----------------------------------------------------------------------------- |
| `npm run dev`            | ホットリロード付きでデスクトップアプリを起動                                  |
| `npm run build`          | 型チェックを行い、main、preload、renderer をコンパイル                        |
| `npm run typecheck`      | Node (`tsconfig.node.json`) と Web (`tsconfig.web.json`) の両方の型をチェック |
| `npm run start`          | 本番ビルドのプレビュー                                                        |
| `npm run tts:server`     | ローカル RVC TTS Python 音声サーバーを起動                                    |
| `npm run smoke`          | 完全なスモークテストスイートを実行（shared, i18n, store, multirepo, app）     |
| `npm run smoke:shared`   | 高速な Node 専用共有モジュールスモークテストを実行                            |
| `npm run smoke:store`    | データベーススキーマとマイグレーションガードを検証                            |
| `npm run smoke:i18n`     | `default.json` スキーマに対して翻訳カタログを検証                             |
| `npm run i18n`           | 全 10 言語の翻訳完了ステータスをレポート                                      |
| `npm run i18n:sync`      | 翻訳カタログのキーを `default.json` と同期                                    |
| `npm run i18n:translate` | OpenRouter を使って不足しているキーを翻訳                                     |
| `npm run format`         | Prettier でコードを整形                                                       |
| `npm run format:check`   | コード整形をチェック                                                          |
| `npm run build:win`      | Windows 用実行ファイル / インストーラーをビルド                               |
| `npm run build:mac`      | macOS 用アプリケーションバンドルをビルド                                      |
| `npm run build:linux`    | Linux 配布用パッケージ (AppImage, deb) をビルド                               |

## アーキテクチャの解説

- **コンテキスト分離は有効**で、`nodeIntegration` は無効です。レンダラーは [`src/preload`](src/preload/index.ts) で定義された型付きの `window.api` ブリッジを通してのみメインプロセスと通信します。
- IPC ハンドラーは [`src/main/ipc`](src/main/ipc/index.ts) に配置されています。レンダラー向けの新しい機能を追加する場合は、ここに `ipcMain.handle(...)` を登録し、プリロードブリッジに対応するメソッドを公開します。

### エージェント基盤

メインプロセスは単一のプロバイダー非依存エージェントループを実行します。レンダラーはイベントのストリーミングのみを受け取ります。

- **ツールループ** — [`src/main/harness/agent.ts`](src/main/harness/agent.ts) がターンループ、ツール JSON スキーマ（`BASE_SCHEMAS`）、コンテキスト削減、サブエージェント委譲を管理します。[`tools.ts`](src/main/harness/tools.ts) が正式な `runTool` ディスパッチャーです。[`src/shared/tools.ts`](src/shared/tools.ts) の UI 向けカタログ（「Skills & Tools」ページ）はこれをミラーリングしており、共有スモークスイートによって乖離が防止されます。
- **プロバイダー** — 独自実装の OpenAI/Copilot SSE パス（Copilot の短寿命トークンの自動リフレッシュ付き）は [`services/llm.ts`](src/main/services/llm.ts) にあります。Anthropic と Google は [`services/aisdk.ts`](src/main/services/aisdk.ts) の Vercel AI SDK を経由し、すべてのモデルファミリーでツール呼び出しが利用可能です。
- **プロンプトとエージェント** — モデルごとに調整されたプロンプトは [`src/shared/prompt.ts`](src/shared/prompt.ts) で選択され、[`prompt-text.ts`](src/shared/prompt-text.ts) 内で `resources/prompts/*.txt` から `?raw` によりインライン化されます。Plan/Build エージェントおよびサブエージェントは [`src/shared/agents.ts`](src/shared/agents.ts) で定義されており、エージェントの `tools` 許可リストと `promptFile` によって Plan が確実に読み取り専用になります。
- **コンテキスト管理** — モデルの実際の上限に対してオーバーフローを計測します（[`src/shared/context.ts`](src/shared/context.ts)）。大きなツール出力はプレビューポインタとともにディスクに退避され（[`services/tool-output-store.ts`](src/main/services/tool-output-store.ts)）、過去のターンは [`services/compaction.ts`](src/main/services/compaction.ts) によって要約されます。
- **エコシステム** — MCP クライアント（[`services/mcp.ts`](src/main/services/mcp.ts)）による外部ツールサーバー、編集後にフィードバックされる Language Server の診断情報（[`services/lsp.ts`](src/main/services/lsp.ts)）、オンデマンドの `SKILL.md` スキル（[`services/skills.ts`](src/main/services/skills.ts)）。Roxy の永続ブラウザツールセット（[`services/browser.ts`](src/main/services/browser.ts)）や定期実行ループ（[`services/loops.ts`](src/main/services/loops.ts)）も同じループで動作します。

### 内蔵 IDE と Git ワークフロー

- **ファイルエディタとツリー** — [`src/renderer/src/components/FileEditor.tsx`](src/renderer/src/components/FileEditor.tsx) は、Shiki によるシンタックスハイライト、アクティブファイルタブ、コンテキスト添付を備えたアプリ内エディタを提供します。
- **Git アクションとコンフリクト解決** — [`src/renderer/src/components/GitActionsView.tsx`](src/renderer/src/components/GitActionsView.tsx) および [`MergeConflictSolver.tsx`](src/renderer/src/components/MergeConflictSolver.tsx) は、ブランチ履歴、ステージされた変更、diff インスペクション、3 方向マージコンフリクト解決をビジュアルに表示します。
- **ターミナルエミュレーター** — `@xterm/xterm` と `node-pty` をベースに構築され、シェルセッションは [`src/main/services/shell-session.ts`](src/main/services/shell-session.ts) および [`src/renderer/src/components/TerminalView.tsx`](src/renderer/src/components/TerminalView.tsx) で管理されます。

### Live2D パートナーと音声合成

- **Live2D アバター** — [`Live2dCanvas.tsx`](src/renderer/src/components/Live2dCanvas.tsx) および [`VtuberStandalone.tsx`](src/renderer/src/components/VtuberStandalone.tsx) 内で Cubism Core を介してレンダリングされ、インタラクティブな物理演算、表情トリガー、音声リップシンクを備えています。
- **RVC v2 推論** — ローカル Python デーモン [`script/rvc_tts_server.py`](script/rvc_tts_server.py) が edge-tts 生成と、`RoxyMigurdia/` 内のチェックポイントを使用したローカル GPU ピッチ/声質変換を組み合わせます。
- **音声認識 (STT)** — [`src/main/services/stt.ts`](src/main/services/stt.ts) が音声入力を取得し、faster-whisper（[`script/transcribe.py`](script/transcribe.py)）を使用してローカルで文字起こしを行います。

### リモートワークスペース

実行中のセッションをスマートフォンに持ち出すことができます。**Remote Workspace**（サイドバー左下の **CUSTOMIZE** グループ）がルームを発行し、QR コード + 安全な URL + PIN を表示し、デスクトップを正式なホストとして維持したまま、スマートフォンをシンクライアントとして操作できます — **コードやファイルがマシンから外に出ることは決してありません**。中継されるのはチャット履歴とストリーミングされるエージェントイベントのみです。

- **ホストサービス** — [`main/services/remote.ts`](src/main/services/remote.ts) がリレーサーバー（`ROXY_REMOTE_BASE` で設定、デフォルトは `https://roxy.schvis.com`）上でセッションを発行し、**ホストトークン**を保持して常時 WebSocket 接続を維持します。ゲストの `hello` で履歴スナップショットを送信し、ゲストの `prompt` でターンをローカルで実行し、各 `LlmEvent` をスマートフォンとローカルレンダラーへ同時にストリーミングします。
- **単一ループで乖離なし** — ローカルの `llm:start` IPC 呼び出しとリモートプロンプトはどちらも [`main/services/session-turn.ts`](src/main/services/session-turn.ts) の `runSessionTurn` を経由して実行されます。
- **セキュリティ** — ログイン不要の認証：URL フラグメントを介して短寿命の HMAC ゲストトークンが渡され、スマートフォンはデスクトップに表示された 6 桁の **PIN** を入力する必要があります。停止時、PIN の連続誤入力時、またはデスクトップ切断時にルームは自動的に破棄されます。

<a id="translations"></a>

## 翻訳

Roxy は English、简体中文、हिन्दी、Español、العربية、Français、Português、Русский、Deutsch、日本語に対応しています。ネイティブスピーカーの協力によって、より明確で自然なインターフェースに改善できます。Issue や pull request の説明は、これらのどの言語で書いても歓迎されます。

- 英語の原文は [`src/renderer/src/locales/default.json`](src/renderer/src/locales/default.json) にあります。
- 翻訳カタログは [`src/renderer/src/locales`](src/renderer/src/locales) にあります。
- UI テキストの編集や言語の追加を行う前に、[ローカライズガイド](AGENTS.md#user-facing-strings-live-in-defaultjson) を確認してください。
- `npm run i18n` を実行して、カタログの構造、プレースホルダー、インラインマークアップを検証してください。

## ライセンス

[MIT](LICENSE) © Roxy.

このプロジェクトは MIT ライセンスの [opencode](https://github.com/sst/opencode) をベースにした [Roxy](https://github.com/roxy-gg/roxy) のフォークであり、本プロジェクト自体の著作権とともにそれらの著作権を保持しています。詳細は [LICENSE](LICENSE) および [`resources/prompts/ATTRIBUTION.txt`](resources/prompts/ATTRIBUTION.txt) を参照してください。
