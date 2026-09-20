<div dir="rtl">

<p align="center">
  <a href="https://roxy.gg">
    <img src="roxy.png" alt="Roxy" width="640" />
  </a>
</p>

<p align="center">
  <strong>اللغات:</strong>
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
  <a href="#translations">ساهم بلغتك</a>
</p>

# Roxy

> وكيل برمجة مفتوح المصدر ومدعوم بالذكاء الاصطناعي، صُمم للمهندسين كتطبيق سطح مكتب متعدد المنصات.

هذا المشروع هو تفريع من [Roxy](https://github.com/roxy-gg/roxy)، والمبني على [opencode](https://github.com/sst/opencode).

**التنزيل:** [https://roxy.gg](https://roxy.gg)

Roxy هو تطبيق [Electron](https://www.electronjs.org/) مكتوب بلغة **TypeScript** ويستخدم واجهة **React**. تتضمن العملية الرئيسية بيئة وكلاء متكاملة (**harness**): حلقة استدعاء أدوات مستقلة عن مزود النموذج، وتعليمات نظام مخصصة لكل نموذج، ووكلاء Plan/Build ووكلاء فرعيين، وإدارة للسياق مدعومة بالقرص، وتكاملات مع خوادم MCP وتشخيصات خوادم اللغة ومهارات `SKILL.md`.

إلى جانب حلقة الوكيل، يدمج Roxy بيئة تطوير متكاملة (IDE) مدمجة مع حل تعارضات Git، ورفيقة تفاعلية بتقنية Live2D مع توليد صوتي محلي RVC مسرّع عبر معالج الرسوميات (GPU)، وخادم ترحيل Remote Workspace مستضاف ذاتياً للتحكم عبر الهاتف، وحلقات ذاتية مجدولة، ومحطات طرفية أصلية.

## الميزات الرئيسية

- **بيئة الوكيل (Agent Harness)** — حلقة تنفيذ أدوات مستقلة عن المزود مع وضعي Plan (للقراءة فقط) وBuild، وتفويض للوكلاء الفرعيين، وضغط تلقائي للسياق، وتفريغ مخرجات الأدوات الكبيرة على القرص.
- **مزودون متعددون ونقاط نهاية مخصصة** — دعم أصلي لـ OpenAI وCopilot (مع تحديث تلقائي للرموز المميزة) وAnthropic وGoogle Gemini عبر Vercel AI SDK، والنماذج المحلية، ونقاط نهاية مخصصة لتوليد الصور.
- **بيئة تطوير مدمجة وعمليات Git** — محرر شفرة مدمج مع تمييز الصيغة (Shiki)، وزخارف الفروق بين الأسطر (diff)، وحلال مرئي لتعارضات الدمج، ورسم بياني تفاعلي لالتزامات Git، وإدارة مساحات عمل متعددة المستودعات.
- **محطة طرفية مدمجة** — محاكي طرفية مسرّع بالعتاد مدعوم بـ `@xterm/xterm` و`node-pty` يدعم جلسات شل الدائمة، والنوافذ المنبثقة المستقلة، وسجل الأوامر.
- **رفيقة Live2D وتوليد صوتي** — شخصية تفاعلية Live2D لـ Roxy Migurdia بتعبيرات وردود فعل متحركة (تفاعلات التربيت على الرأس / الصدر)، مقترنة بتحويل صوتي محلي غير متصل RVC (Retrieval-based Voice Conversion) v2 مسرّع بالـ GPU عبر TTS، وإدخال صوتي STT عبر faster-whisper، أو أصوات سحابية عبر Fish Audio.
- **مساحة عمل بعيدة وترحيل للهاتف** — اقتران مع الهاتف أو الجهاز اللوحي عبر رمز QR ورمز PIN دون توجيه الشفرة عبر أطراف ثالثة؛ افتراضياً عبر `https://roxy.schvis.com` (قابل للتهيئة عبر `ROXY_REMOTE_BASE`)، مع دعم خادم ترحيل Next.js App Router مستقل ومستضاف ذاتياً في `remote-server/` (غير مضمن / مهمل بواسطة git).
- **المنظومة وقابلية التوسيع** — عميل بروتوكول سياق النموذج (MCP) + Windows MCP، وتغذية راجعة لتشخيصات بروتوكول خادم اللغة (LSP)، ومشغّل مهارات `SKILL.md`، وأتمتة متصفح Chromium الدائمة، وDiscord Rich Presence.
- **تدويل كامل** — توطين شامل للواجهة عبر 10 لغات (العربية، الألمانية، الإنجليزية، الإسبانية، الفرنسية، الهندية، اليابانية، البرتغالية، الروسية، الصينية) متزامن عبر أدوات مؤتمتة.

## التقنيات

| الطبقة                   | التقنية                                                             |
| ------------------------ | ------------------------------------------------------------------- |
| سطح المكتب               | Electron 33                                                         |
| أداة البناء              | electron-vite (Vite 5)                                              |
| الواجهة                  | React 18 + TypeScript                                               |
| التنسيق                  | Tailwind CSS v4                                                     |
| استدعاء الأدوات والنماذج | Vercel AI SDK (Anthropic, Google) + دعم أصلي لـ OpenAI, Copilot SSE |
| المحطة الطرفية           | @xterm/xterm 6 + node-pty                                           |
| عارض الشفرة والفروق      | Shiki + diff                                                        |
| التكاملات                | حزمة أدوات Model Context Protocol (MCP)، LSP، Discord RPC           |
| محرك الصوت               | RVC v2 محلي (PyTorch/CUDA) + faster-whisper + واجهة Fish Audio      |
| الرفيقة                  | Live2D Cubism Core                                                  |
| التخزين                  | better-sqlite3                                                      |
| الحزم                    | electron-builder                                                    |
| التوطين                  | i18next + react-i18next (10 لغات)                                   |
| التنسيق                  | Prettier                                                            |

## بنية المشروع

```
roxy/
├── build/                  # موارد التحزيم (الأيقونات والأذونات)
├── remote-server/          # خادم ترحيل Next.js مستقل وعميل هاتف (مهمل بـ git، ليس في التزامات المستودع)
├── resources/              # موارد ثابتة مجمعة مع التطبيق
│   ├── models/live2d/      # أصول الشخصية الرفيقة Live2D Cubism
│   ├── prompts/            # مطالبات النظام المضبوطة للنماذج والوكلاء (مدمجة عبر ?raw)
│   └── voicelines/         # مشغلات الصوت التفاعلية للرفيقة
├── RoxyMigurdia/           # نقاط فحص نموذج الصوت RVC (.pth) وفهارس الميزات (.index)
├── script/                 # نصوص الإعداد وخوادم TTS/STT وترجمة i18n والتحزيم
│   ├── rvc_tts_server.py   # خادم استدلال RVC TTS محلي بمعالج الرسوميات (منفذ 5050)
│   ├── setup_tts_env.py    # مثبت تلقائي لبيئة Python واعتماديات CUDA
│   ├── transcribe.py       # مشغّل التعرف الصوتي STT عبر faster-whisper
│   ├── i18n-sync.mjs       # أداة مزامنة الكتالوج لـ default.json
│   └── i18n-translate.mjs  # مشغّل الترجمة الآلية عبر OpenRouter
├── src/
│   ├── main/               # عملية Electron الرئيسية (Node.js)
│   │   ├── index.ts        # دورة حياة التطبيق وإنشاء النوافذ وبدء الخدمات
│   │   ├── harness/        # حلقة الوكيل: agent.ts (حلقة الجولات، مخططات الأدوات)، tools.ts (التوزيع)
│   │   ├── services/       # llm.ts, aisdk.ts, mcp.ts, lsp.ts, tts.ts, stt.ts, browser.ts, remote.ts, …
│   │   ├── db/             # تخزين better-sqlite3: المخطط، الترحيلات، طبقة المستودع
│   │   └── ipc/            # معالجات ipcMain التي تربط المفسر ببيئة الوكيل والخدمات
│   ├── preload/            # جسر آمن بين العملية الرئيسية والواجهة (window.api)
│   ├── renderer/           # تطبيق React (Chromium): المسارات، المكونات، المخزن
│   │   └── src/
│   │       ├── components/ # ChatView, FileEditor, GitActionsView, Live2dCanvas, McpServers, …
│   │       └── locales/    # مصدر الحقيقة default.json وكتالوجات 10 لغات
│   └── shared/             # وحدات نقية مشتركة بين العمليات: tools, agents, prompt/prompt-text,
│                           #   providers, context, tool-history, mcp, lsp, skills, types
├── test/                   # مجموعات اختبارات الدخان (تطبيق Electron، Node المشترك، المخزن، i18n، اللوحة)
├── electron.vite.config.ts # إعدادات بناء main / preload / renderer
└── electron-builder.yml    # إعدادات حزم التوزيع
```

## البدء

### المتطلبات الأساسية

- **Node.js** >= 20
- **Python** >= 3.10 (اختياري، مطلوب لتوليد الصوت RVC المحلي والتعرف الصوتي STT)
- **بطاقة رسوميات NVIDIA مع CUDA** (موصى بها للتحويل الصوتي المحلي؛ وضع CPU مدعوم أيضاً)

### تثبيت وتشغيل تطبيق سطح المكتب

```bash
# تثبيت الاعتماديات
npm install

# التشغيل في وضع التطوير (مع التحديث الحي)
npm run dev
```

### إعداد محرك الصوت (اختياري)

يمكن لـ Roxy نطق الردود باستخدام نموذج تحويل صوت RVC محلي:

```bash
# 1. تثبيت اعتماديات الصوت في Python وPyTorch CUDA وRVC
python script/setup_tts_env.py

# 2. تشغيل خادم RVC TTS المحلي (يستمع على http://127.0.0.1:5050)
npm run tts:server
```

يمكنك أيضاً تمكين **Fish Audio API** من الإعدادات للتوليد الصوتي السحابي دون الحاجة إلى معالج رسوميات محلي.

## أوامر مفيدة

| الأمر                    | الوصف                                                                       |
| ------------------------ | --------------------------------------------------------------------------- |
| `npm run dev`            | تشغيل تطبيق سطح المكتب مع التحديث السريع                                    |
| `npm run build`          | التحقق من الأنواع وتجميع main وpreload وrenderer                            |
| `npm run typecheck`      | التحقق من أنواع Node (`tsconfig.node.json`) وWeb (`tsconfig.web.json`) معاً |
| `npm run start`          | معاينة نسخة الإنتاج                                                         |
| `npm run tts:server`     | تشغيل خادم الصوت المحلي Python RVC TTS                                      |
| `npm run smoke`          | تشغيل حزمة اختبارات الدخان الكاملة (shared, i18n, store, multirepo, app)    |
| `npm run smoke:shared`   | تشغيل اختبارات دخان سريعة للوحدات المشتركة في Node فقط                      |
| `npm run smoke:store`    | التحقق من مخطط قاعدة البيانات وحراس الترحيل                                 |
| `npm run smoke:i18n`     | التحقق من كتالوجات الترجمة مقابل مخطط `default.json`                        |
| `npm run i18n`           | تقرير حالة اكتمال الترجمة عبر جميع اللغات العشر                             |
| `npm run i18n:sync`      | مزامنة مفاتيح كتالوجات الترجمة مع `default.json`                            |
| `npm run i18n:translate` | ترجمة المفاتيح المفقودة عبر OpenRouter                                      |
| `npm run format`         | تنسيق الشفرة باستخدام Prettier                                              |
| `npm run format:check`   | فحص تنسيق الشفرة                                                            |
| `npm run build:win`      | إنشاء الملف التنفيذي / المثبّت لنظام Windows                                |
| `npm run build:mac`      | إنشاء حزمة تطبيق macOS                                                      |
| `npm run build:linux`    | إنشاء حزم توزيع Linux (AppImage وdeb)                                       |

## البنية المعمارية

- **عزل السياق مفعّل** و`nodeIntegration` معطّل. تتواصل الواجهة مع العملية الرئيسية فقط عبر جسر `window.api` المكتوب بأنواع والمحدد في [`src/preload`](src/preload/index.ts).
- توجد معالجات IPC في [`src/main/ipc`](src/main/ipc/index.ts). أضف إمكانية جديدة موجهة للواجهة بتسجيل `ipcMain.handle(...)` هناك وإتاحة الطريقة المقابلة في جسر preload.

### بيئة الوكيل (Agent Harness)

تشغّل العملية الرئيسية حلقة وكيل واحدة مستقلة عن المزود؛ وتكتفي الواجهة باستقبال الأحداث المتدفقة.

- **حلقة الأدوات** — يدير ملف [`src/main/harness/agent.ts`](src/main/harness/agent.ts) حلقة الجولات ومخططات JSON للأدوات (`BASE_SCHEMAS`) واقتطاع السياق وتوجيه الوكلاء الفرعيين. ويعد [`tools.ts`](src/main/harness/tools.ts) الموزع الرسمي لـ `runTool`. ويعكسه كتالوج الواجهة في [`src/shared/tools.ts`](src/shared/tools.ts) (صفحة "Skills & Tools") والمحمي ضد الانحراف بواسطة حزمة اختبارات الدخان المشتركة.
- **المزودون** — مسار SSE المكتوب يدوياً لـ OpenAI/Copilot (مع تحديث رمز Copilot قصير الأجل) يوجد في [`services/llm.ts`](src/main/services/llm.ts)؛ بينما يمر Anthropic + Google عبر Vercel AI SDK في [`services/aisdk.ts`](src/main/services/aisdk.ts) لتتمتع جميع العائلات باستدعاء الأدوات.
- **المطالبات والوكلاء** — تُحدد المطالبات المضبوطة لكل نموذج في [`src/shared/prompt.ts`](src/shared/prompt.ts) وتُضمّن من `resources/prompts/*.txt` عبر `?raw` في [`prompt-text.ts`](src/shared/prompt-text.ts). ويُعرّف وكلاء Plan/Build والوكلاء الفرعيون في [`src/shared/agents.ts`](src/shared/agents.ts)؛ وتضمن قائمة الأدوات المسموحة (`tools`) وملف `promptFile` أن يكون وضع Plan للقراءة فقط حقاً.
- **إدارة السياق** — يُقاس الفائض مقابل الحد الحقيقي للنموذج ([`src/shared/context.ts`](src/shared/context.ts))؛ وتُفرّغ مخرجات الأدوات الكبيرة على القرص مع مؤشر معاينة ([`services/tool-output-store.ts`](src/main/services/tool-output-store.ts))؛ وتُلخّص الجولات الأقدم عبر [`services/compaction.ts`](src/main/services/compaction.ts).
- **المنظومة** — خوادم أدوات خارجية عبر عميل MCP ([`services/mcp.ts`](src/main/services/mcp.ts))، وتغذية راجعة لتشخيصات خادم اللغة بعد التعديلات ([`services/lsp.ts`](src/main/services/lsp.ts))، ومهارات `SKILL.md` عند الطلب ([`services/skills.ts`](src/main/services/skills.ts)). وتعمل أدوات متصفح Chromium الدائمة لـ Roxy ([`services/browser.ts`](src/main/services/browser.ts)) والحلقات المجدولة المتكررة ([`services/loops.ts`](src/main/services/loops.ts)) عبر نفس الحلقة.

### بيئة التطوير المدمجة وسير عمل Git

- **محرر الملفات وشجرة الملفات** — يوفّر [`src/renderer/src/components/FileEditor.tsx`](src/renderer/src/components/FileEditor.tsx) محرراً مدمجاً مع تمييز الصيغة عبر Shiki وعلامات تبويب للملفات النشطة وإرفاق السياق.
- **عمليات Git وحل التعارضات** — يعرض [`src/renderer/src/components/GitActionsView.tsx`](src/renderer/src/components/GitActionsView.tsx) و[`MergeConflictSolver.tsx`](src/renderer/src/components/MergeConflictSolver.tsx) سجلاً مرئياً للفروع، والتغييرات المرحّلة، وفحص الفروق، وحل تعارضات الدمج الثلاثي.
- **محاكي الطرفية** — مبني على `@xterm/xterm` و`node-pty` مع إدارة جلسات الشل في [`src/main/services/shell-session.ts`](src/main/services/shell-session.ts) و[`src/renderer/src/components/TerminalView.tsx`](src/renderer/src/components/TerminalView.tsx).

### رفيقة Live2D وتوليد الصوت

- **شخصية Live2D** — تُعرض عبر Cubism Core في [`Live2dCanvas.tsx`](src/renderer/src/components/Live2dCanvas.tsx) و[`VtuberStandalone.tsx`](src/renderer/src/components/VtuberStandalone.tsx) بفيزياء تفاعلية ومحفزات للتعبيرات ومزامنة لحركة الشفاه مع الصوت.
- **استدلال RVC v2** — يجمع الخادم المحلي بلغة Python في [`script/rvc_tts_server.py`](script/rvc_tts_server.py) بين توليد edge-tts والتحويل الصوتي للنبرة والجرس عبر معالج الرسوميات المحلي باستخدام نقاط الفحص في `RoxyMigurdia/`.
- **تحويل الكلام إلى نص (STT)** — يلتقط [`src/main/services/stt.ts`](src/main/services/stt.ts) المطالبات الصوتية ويحولها إلى نص محلياً باستخدام faster-whisper ([`script/transcribe.py`](script/transcribe.py)).

### مساحة العمل البعيدة

انقل جلسة نشطة إلى هاتفك. تنشئ ميزة **Remote Workspace** (مجموعة **CUSTOMIZE** في أسفل يسار الشريط الجانبي) غرفة، وتعرض رمز QR + رابطاً آمناً + رمز PIN، وتُبقي سطح المكتب هو المضيف الرئيسي بينما يتحكم الهاتف كعميل خفيف — **شفرتك وملفاتك لا تغادر جهازك أبداً**؛ ولا يُنقل سوى سجل المحادثة وأحداث الوكيل المتدفقة.

- **خدمة المضيف** — ينشئ [`main/services/remote.ts`](src/main/services/remote.ts) الجلسة على خادم الترحيل (المحدد عبر `ROXY_REMOTE_BASE`، افتراضياً `https://roxy.schvis.com`)، ويحتفظ بـ **رمز المضيف**، ويحافظ على اتصال WebSocket مستمر. عند تلقي `hello` من الضيف يُرسل لقطة من السجل؛ وعند تلقي `prompt` من الضيف ينفّذ الجولة محلياً، مع بث كل حدث `LlmEvent` إلى الهاتف والواجهة المحلية في نفس الوقت.
- **حلقة واحدة، دون أي انحراف** — تُنفّذ استدعاءات IPC المحلية `llm:start` والمطالبات البعيدة كلاهما عبر `runSessionTurn` في [`main/services/session-turn.ts`](src/main/services/session-turn.ts).
- **الأمان** — مصادقة دون تسجيل دخول: يُمرر رمز ضيف HMAC قصير الأجل عبر جزء الرابط (fragment)، ويجب على الهاتف إدخال رمز الـ **PIN** المكون من 6 أرقام والمعروض على سطح المكتب. تُلغى الغرف تلقائياً عند الإيقاف، أو بعد تكرار محاولات PIN الخاطئة، أو عند انقطاع اتصال سطح المكتب.

<a id="translations"></a>

## الترجمات

يتوفر Roxy باللغات English و简体中文 وहिन्दी وEspañol والعربية وFrançais وPortuguês وРусский وDeutsch و日本語. يمكن للناطقين الأصليين المساعدة في جعل الواجهة أكثر وضوحاً وطبيعية. نرحب بفتح الـ Issues وكتابة أوصاف طلبات السحب (Pull Requests) بأي من هذه اللغات.

- توجد نصوص المصدر الإنجليزية في [`src/renderer/src/locales/default.json`](src/renderer/src/locales/default.json).
- توجد كتالوجات الترجمة في [`src/renderer/src/locales`](src/renderer/src/locales).
- راجع [دليل التوطين](AGENTS.md#user-facing-strings-live-in-defaultjson) قبل تعديل نصوص الواجهة أو إضافة لغة.
- شغّل `npm run i18n` للتحقق من بنية الكتالوجات والعناصر النائبة والوسوم المضمنة.

## الترخيص

[MIT](LICENSE) © Roxy.

هذا المشروع هو تفريع من [Roxy](https://github.com/roxy-gg/roxy) المبني على [opencode](https://github.com/sst/opencode) (المطروح أيضاً برخصة MIT)، ويحتفظ بحقوق النشر الخاصة بهما إلى جانب حقوق هذا المشروع. راجع [LICENSE](LICENSE) و[`resources/prompts/ATTRIBUTION.txt`](resources/prompts/ATTRIBUTION.txt) لمزيد من التفاصيل.

</div>
