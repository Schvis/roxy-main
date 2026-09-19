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

**التنزيل:** [https://roxy.gg](https://roxy.gg)

Roxy هو تطبيق [Electron](https://www.electronjs.org/) مكتوب بلغة **TypeScript** ويستخدم واجهة **React**. تتضمن العملية الرئيسية نظام وكلاء متكاملاً: حلقة أدوات مستقلة عن مزود النموذج، وتعليمات مخصصة لكل نموذج، ووكلاء Plan/Build ووكلاء فرعيين، وإدارة للسياق على القرص، وتكاملات مع خوادم MCP وتشخيصات خوادم اللغة ومهارات `SKILL.md`.

## التقنيات

| الطبقة          | التقنية                            |
| --------------- | ---------------------------------- |
| سطح المكتب      | Electron 33                        |
| البناء          | electron-vite (Vite 5)             |
| الواجهة         | React 18 + TypeScript              |
| التنسيق         | Tailwind CSS v4                    |
| استدعاء الأدوات | Vercel AI SDK (Anthropic + Google) |
| التكاملات       | Model Context Protocol SDK         |
| التخزين         | better-sqlite3                     |
| الحزم           | electron-builder                   |
| تنسيق الشفرة    | Prettier                           |

## بنية المشروع

```text
roxy/
├── build/                  # موارد الحزم مثل الأيقونات والأذونات
├── resources/              # موارد ثابتة مرفقة مع التطبيق
│   └── prompts/            # تعليمات مخصصة للنماذج والوكلاء
├── src/
│   ├── main/               # عملية Electron الرئيسية (Node.js)
│   │   ├── index.ts        # دورة حياة التطبيق والنوافذ وبدء الخدمات
│   │   ├── harness/        # حلقة الوكيل وتنفيذ الأدوات
│   │   ├── services/       # LLM وMCP وLSP والمهارات والمتصفح والحلقات
│   │   ├── db/             # مخطط better-sqlite3 والترحيلات والمستودع
│   │   └── ipc/            # اتصال IPC بين الواجهة والخدمات
│   ├── preload/            # جسر window.api الآمن
│   ├── renderer/           # تطبيق React (Chromium)
│   └── shared/             # وحدات مشتركة بين العمليات
├── test/                   # اختبارات التحقق والاختبارات الأولية
├── electron.vite.config.ts # إعدادات البناء
└── electron-builder.yml    # إعدادات التوزيع
```

## البدء

```bash
# تثبيت الاعتماديات
npm install

# التشغيل في وضع التطوير مع التحديث التلقائي
npm run dev
```

## أوامر مفيدة

| الأمر                 | الوصف                                        |
| --------------------- | -------------------------------------------- |
| `npm run dev`         | يشغّل التطبيق مع التحديث التلقائي            |
| `npm run build`       | يتحقق من الأنواع وينشئ نسخة الإنتاج          |
| `npm run typecheck`   | يتحقق من أنواع main وpreload وrenderer       |
| `npm run smoke`       | يشغّل الاختبارات المشتركة واختبارات Electron |
| `npm run format`      | ينسق المستودع باستخدام Prettier              |
| `npm run build:win`   | ينشئ مثبّت Windows                           |
| `npm run build:mac`   | ينشئ تطبيق macOS                             |
| `npm run build:linux` | ينشئ حزم Linux من نوع AppImage وdeb          |

## البنية المعمارية

- عزل السياق مفعّل و`nodeIntegration` معطّل. تتواصل الواجهة مع العملية الرئيسية فقط عبر جسر `window.api` المعرّف بأنواع في [`src/preload`](src/preload/index.ts).
- توجد معالجات IPC في [`src/main/ipc`](src/main/ipc/index.ts). عند إضافة ميزة للواجهة، سجّل `ipcMain.handle(...)` هناك ووفّر الطريقة المقابلة في جسر preload.

### نظام الوكلاء

تشغّل العملية الرئيسية حلقة وكيل واحدة مستقلة عن المزود؛ أما الواجهة فتستقبل الأحداث المتدفقة فقط.

- **حلقة الأدوات:** يدير [`src/main/harness/agent.ts`](src/main/harness/agent.ts) الجولات ومخططات `BASE_SCHEMAS` وتقليص السياق والوكلاء الفرعيين. ويحتوي [`tools.ts`](src/main/harness/tools.ts) على موزع `runTool` المعتمد.
- **المزودون:** يوجد تكامل SSE الخاص بـ OpenAI/Copilot في [`services/llm.ts`](src/main/services/llm.ts). ويستخدم Anthropic وGoogle حزمة Vercel AI SDK عبر [`services/aisdk.ts`](src/main/services/aisdk.ts).
- **التعليمات والوكلاء:** يختار [`src/shared/prompt.ts`](src/shared/prompt.ts) التعليمات المناسبة لكل نموذج. وتُعرّف وكلاء Plan/Build والوكلاء الفرعيون في [`src/shared/agents.ts`](src/shared/agents.ts).
- **إدارة السياق:** يراعي [`src/shared/context.ts`](src/shared/context.ts) الحد الفعلي لكل نموذج؛ وتُحفظ المخرجات الكبيرة على القرص وتُلخّص الجولات القديمة.
- **المنظومة:** تستخدم MCP وتشخيصات LSP ومهارات `SKILL.md` والمتصفح الدائم والحلقات المتكررة نظام الوكلاء نفسه.

### مساحة العمل البعيدة

تابع جلسة نشطة من هاتفك. تنشئ **Remote Workspace** غرفة على roxy.gg وتعرض رمز QR وعنوان URL آمناً ورمز PIN، بينما يبقى جهاز سطح المكتب هو المضيف الرئيسي. **لا تغادر الشفرة والملفات جهازك أبداً**؛ ولا يُنقل سوى المحادثة وأحداث الوكيل.

- ينشئ [`main/services/remote.ts`](src/main/services/remote.ts) الجلسة عبر `POST https://roxy.gg/api/remote/sessions`، ويحفظ رمز المضيف ويحافظ على اتصال WebSocket.
- تستخدم الطلبات المحلية والبعيدة الدالة `runSessionTurn` في [`main/services/session-turn.ts`](src/main/services/session-turn.ts)، لذلك يكون سلوكها متطابقاً.
- تتضمن واجهة IPC الأوامر `remote:start` و`remote:stop` و`remote:status` وأحداث `remote:state`. توجد نافذة رمز QR في [`renderer/src/components/RemoteWorkspaceDialog.tsx`](src/renderer/src/components/RemoteWorkspaceDialog.tsx).
- تُلغى الغرفة عند إيقاف المشاركة، أو بعد محاولات PIN خاطئة كثيرة، أو عند انتهاء الصلاحية، أو بعد انقطاع جهاز سطح المكتب. راجع البروتوكول في [README الخاص بـ roxy.gg](../roxy.gg/README.md#remote-workspace).

<a id="translations"></a>

## الترجمات

يتوفر Roxy باللغات English و简体中文 وहिन्दी وEspañol والعربية وFrançais وPortuguês وРусский وDeutsch و日本語. يمكن للناطقين بهذه اللغات مساعدتنا على جعل الواجهة أوضح وأكثر طبيعية. نرحب بكتابة الـ issues ووصف pull requests بأي من هذه اللغات.

- توجد النصوص الإنجليزية المصدر في [`src/renderer/src/locales/default.json`](src/renderer/src/locales/default.json).
- توجد كتالوجات الترجمة في [`src/renderer/src/locales`](src/renderer/src/locales).
- اقرأ [دليل الترجمة](AGENTS.md#user-facing-strings-live-in-defaultjson) قبل تعديل نصوص الواجهة أو إضافة لغة.
- شغّل `npm run i18n` للتحقق من البنية والعناصر النائبة والترميز المضمّن.

## الترخيص

[MIT](LICENSE) © Roxy.

Roxy هو نسخة متفرعة من [opencode](https://github.com/sst/opencode)، وهو منشور أيضاً بترخيص MIT، ويحتفظ بإشعارات حقوقه إلى جانب إشعارات Roxy. راجع [LICENSE](LICENSE) و[`resources/prompts/ATTRIBUTION.txt`](resources/prompts/ATTRIBUTION.txt) لمزيد من التفاصيل.

</div>
