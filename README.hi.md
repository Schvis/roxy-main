<p align="center">
  <a href="https://roxy.gg">
    <img src="roxy.png" alt="Roxy" width="640" />
  </a>
</p>

<p align="center">
  <strong>भाषाएँ:</strong>
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
  <a href="#translations">अपनी भाषा में योगदान दें</a>
</p>

# Roxy

> इंजीनियरों के लिए बनाया गया एक ओपन-सोर्स AI कोडिंग एजेंट, जो क्रॉस-प्लेटफ़ॉर्म डेस्कटॉप ऐप के रूप में उपलब्ध है।

यह प्रोजेक्ट [Roxy](https://github.com/roxy-gg/roxy) का एक फ़ोर्क है, जो [opencode](https://github.com/sst/opencode) पर आधारित है।

**डाउनलोड:** [https://roxy.gg](https://roxy.gg)

Roxy एक [Electron](https://www.electronjs.org/) ऐप है, जिसे **TypeScript** में लिखा गया है और जिसका रेंडरर **React** पर आधारित है। इसकी मुख्य प्रक्रिया में पूरा एजेंट **हार्नेस** शामिल है: प्रदाता-स्वतंत्र टूल कॉलिंग लूप, प्रति-मॉडल अनुकूलित सिस्टम प्रॉम्प्ट्स, Plan/Build एजेंट और सबएजेंट, डिस्क-आधारित कॉन्टेक्स्ट प्रबंधन, और MCP सर्वर, भाषा-सर्वर डायग्नोस्टिक्स एवं `SKILL.md` स्किल्स के लिए एकीकरण।

एजेंट लूप के अलावा, Roxy में Git विरोध समाधान के साथ अंतर्निहित IDE, स्थानीय GPU-त्वरित RVC वॉइस सिंथेसिस के साथ इंटरैक्टिव Live2D साथी, मोबाइल नियंत्रण के लिए सेल्फ़-होस्टेड Remote Workspace रिले सर्वर, अनुसूचित स्वायत्त लूप्स और नेटिव टर्मिनल शामिल हैं।

## मुख्य विशेषताएँ

- **एजेंट हार्नेस** — Plan (केवल-पढ़ने योग्य) और Build मोड, सबएजेंट डेलिगेशन, स्वचालित कॉन्टेक्स्ट कॉम्पेक्शन और बड़े टूल आउटपुट को डिस्क पर स्पिल करने की सुविधा वाला प्रदाता-स्वतंत्र टूल निष्पादन लूप।
- **मल्टी-प्रोवाइडर और कस्टम एंडपॉइंट्स** — OpenAI, Copilot (स्वचालित टोकन रीफ़्रेश के साथ), Anthropic, Vercel AI SDK के माध्यम से Google Gemini, स्थानीय मॉडल और कस्टम इमेज जनरेशन एंडपॉइंट्स के लिए नेटिव समर्थन।
- **एकीकृत IDE और Git संचालन** — सिंटैक्स हाइलाइटिंग (Shiki), लाइन डिफ़ डेकोरेशन, विज़ुअल मर्ज कॉन्फ़्लिक्ट सॉल्वर, इंटरैक्टिव Git कमिट ग्राफ़ और मल्टी-रेपो वर्कस्पेस प्रबंधन के साथ इन-ऐप कोड एडिटर।
- **एंबेडेड टर्मिनल** — `@xterm/xterm` और `node-pty` द्वारा संचालित हार्डवेयर-त्वरित टर्मिनल एमुलेटर, जो स्थायी शेल सत्रों, स्टैंडअलोन पॉपआउट्स और कमांड इतिहास का समर्थन करता है।
- **Live2D साथी और वॉइस सिंथेसिस** — एनिमेटेड भावों और प्रतिक्रियाओं (सिर थपथपाने / छाती की बातचीत) के साथ इंटरैक्टिव Roxy Migurdia Live2D अवतार, ऑफ़लाइन GPU-त्वरित RVC (Retrieval-based Voice Conversion) v2 TTS, faster-whisper STT वॉइस इनपुट या Fish Audio क्लाउड वॉइस से युक्त।
- **रिमोट वर्कस्पेस और मोबाइल रिले** — तीसरे पक्ष के माध्यम से कोड भेजे बिना QR कोड और PIN के ज़रिए फ़ोन या टैबलेट से पेयर करें; डिफ़ॉल्ट रूप से `https://roxy.schvis.com` (जिसे `ROXY_REMOTE_BASE` द्वारा कॉन्फ़िगर किया जा सकता है), `remote-server/` में एक स्टैंडअलोन सेल्फ़-होस्टेड Next.js App Router रिले सर्वर के समर्थन के साथ (अनकमिटेड / git द्वारा उपेक्षित)।
- **इकोसिस्टम और विस्तारशीलता** — Model Context Protocol (MCP) क्लाइंट + Windows MCP, Language Server Protocol (LSP) डायग्नोस्टिक्स फ़ीडबैक, `SKILL.md` स्किल रनर, स्थायी Chromium ब्राउज़र ऑटोमेशन और Discord Rich Presence।
- **पूर्ण अंतर्राष्ट्रीयकरण** — स्वचालित उपकरणों द्वारा सिंक्रनाइज़ की गई 10 भाषाओं (अरबी, जर्मन, अंग्रेज़ी, स्पैनिश, फ़्रेंच, हिन्दी, जापानी, पुर्तगाली, रूसी, चीनी) में संपूर्ण UI स्थानीयकरण।

## टेक्नोलॉजी स्टैक

| परत               | तकनीक                                                           |
| ----------------- | --------------------------------------------------------------- |
| डेस्कटॉप          | Electron 33                                                     |
| बिल्ड टूल         | electron-vite (Vite 5)                                          |
| इंटरफ़ेस          | React 18 + TypeScript                                           |
| स्टाइलिंग         | Tailwind CSS v4                                                 |
| टूल-कॉलिंग व मॉडल | Vercel AI SDK (Anthropic, Google) + नेटिव OpenAI, Copilot SSE   |
| टर्मिनल           | @xterm/xterm 6 + node-pty                                       |
| कोड व डिफ़ व्यूअर | Shiki + diff                                                    |
| इंटीग्रेशन        | Model Context Protocol (MCP) SDK, LSP, Discord RPC              |
| वॉइस इंजन         | स्थानीय RVC v2 (PyTorch/CUDA) + faster-whisper + Fish Audio API |
| साथी              | Live2D Cubism Core                                              |
| स्टोरेज           | better-sqlite3                                                  |
| पैकेजिंग          | electron-builder                                                |
| स्थानीयकरण        | i18next + react-i18next (10 भाषाएँ)                             |
| फ़ॉर्मैटिंग       | Prettier                                                        |

## प्रोजेक्ट संरचना

```
roxy/
├── build/                  # पैकेजिंग संसाधन (आइकन, एंटाइटेलमेंट्स)
├── remote-server/          # स्टैंडअलोन Next.js रिले व मोबाइल क्लाइंट (git-उपेक्षित, कमिट में नहीं)
├── resources/              # ऐप के साथ बंडल किए गए स्थिर संसाधन
│   ├── models/live2d/      # Live2D Cubism साथी अवतार संसाधन
│   ├── prompts/            # मॉडल व एजेंट के अनुसार ट्यून किए गए सिस्टम प्रॉम्प्ट्स (?raw द्वारा इनलाइन)
│   └── voicelines/         # इंटरैक्टिव साथी वॉइस ट्रिगर ऑडियो
├── RoxyMigurdia/           # RVC वॉइस मॉडल चेकपॉइंट्स (.pth) और फ़ीचर इंडेक्स (.index)
├── script/                 # सेटअप स्क्रिप्ट्स, TTS/STT डेमन्स, i18n अनुवाद व पैकेजिंग
│   ├── rvc_tts_server.py   # स्थानीय GPU RVC TTS इन्फ़्रेंस डेमन (पोर्ट 5050)
│   ├── setup_tts_env.py    # स्वचालित Python वातावरण व CUDA डिपेंडेंसी इंस्टॉलर
│   ├── transcribe.py       # faster-whisper STT वॉइस रिकग्निशन रनर
│   ├── i18n-sync.mjs       # default.json के लिए कैटलॉग सिंक्रनाइज़र
│   └── i18n-translate.mjs  # OpenRouter द्वारा मशीन अनुवाद रनर
├── src/
│   ├── main/               # Electron मुख्य प्रक्रिया (Node.js)
│   │   ├── index.ts        # ऐप जीवनचक्र, विंडो निर्माण, सेवा स्टार्टअप
│   │   ├── harness/        # एजेंट लूप: agent.ts (टर्न लूप, टूल स्कीमा), tools.ts (डिस्पैच)
│   │   ├── services/       # llm.ts, aisdk.ts, mcp.ts, lsp.ts, tts.ts, stt.ts, browser.ts, remote.ts, …
│   │   ├── db/             # better-sqlite3 स्टोर: स्कीमा, माइग्रेशन, रिपॉज़िटरी लेयर
│   │   └── ipc/            # रेंडरर को हार्नेस व सेवाओं से जोड़ने वाले ipcMain हैंडलर्स
│   ├── preload/            # मुख्य प्रक्रिया और रेंडरर के बीच सुरक्षित ब्रिज (window.api)
│   ├── renderer/           # React ऐप (Chromium): रूट्स, कंपोनेंट्स, स्टोर
│   │   └── src/
│   │       ├── components/ # ChatView, FileEditor, GitActionsView, Live2dCanvas, McpServers, …
│   │       └── locales/    # स्रोत सत्य default.json और 10 भाषा कैटलॉग
│   └── shared/             # शुद्ध क्रॉस-प्रोसेस मॉड्यूल: tools, agents, prompt/prompt-text,
│                           #   providers, context, tool-history, mcp, lsp, skills, types
├── test/                   # स्मोक टेस्ट सुइट्स (Electron ऐप, साझा Node, स्टोर, i18n, कैनवास)
├── electron.vite.config.ts # Main / preload / renderer बिल्ड कॉन्फ़िगरेशन
└── electron-builder.yml    # डिस्ट्रीब्यूशन पैकेजिंग कॉन्फ़िगरेशन
```

## शुरुआत

### पूर्वापेक्षाएँ

- **Node.js** >= 20
- **Python** >= 3.10 (वैकल्पिक, स्थानीय RVC वॉइस सिंथेसिस और स्थानीय STT के लिए आवश्यक)
- **CUDA सहित NVIDIA GPU** (स्थानीय वॉइस रूपांतरण के लिए अनुशंसित; CPU मोड भी समर्थित)

### डेस्कटॉप ऐप इंस्टॉल करें और चलाएँ

```bash
# डिपेंडेंसी इंस्टॉल करें
npm install

# डेवलपमेंट मोड में चलाएँ (हॉट रीलोड)
npm run dev
```

### वॉइस इंजन सेटअप (वैकल्पिक)

Roxy एक स्थानीय RVC वॉइस रूपांतरण मॉडल का उपयोग करके उत्तर बोल सकता है:

```bash
# 1. Python ऑडियो डिपेंडेंसी, PyTorch CUDA और RVC इंस्टॉल करें
python script/setup_tts_env.py

# 2. स्थानीय RVC TTS डेमन शुरू करें (http://127.0.0.1:5050 पर सुनता है)
npm run tts:server
```

आप स्थानीय GPU की आवश्यकता के बिना क्लाउड-आधारित वॉइस सिंथेसिस के लिए सेटिंग्स में **Fish Audio API** भी सक्षम कर सकते हैं।

## उपयोगी स्क्रिप्ट

| स्क्रिप्ट                | विवरण                                                                         |
| ------------------------ | ----------------------------------------------------------------------------- |
| `npm run dev`            | हॉट रीलोड के साथ डेस्कटॉप एप्लिकेशन शुरू करें                                 |
| `npm run build`          | टाइप जाँचें और main, preload और renderer को कंपाइल करें                       |
| `npm run typecheck`      | Node (`tsconfig.node.json`) और Web (`tsconfig.web.json`) दोनों के टाइप जाँचें |
| `npm run start`          | प्रोडक्शन बिल्ड का पूर्वावलोकन करें                                           |
| `npm run tts:server`     | स्थानीय RVC TTS Python वॉइस सर्वर शुरू करें                                   |
| `npm run smoke`          | पूरा स्मोक सुइट चलाएँ (shared, i18n, store, multirepo, app)                   |
| `npm run smoke:shared`   | केवल-Node साझा मॉड्यूल स्मोक टेस्ट तेज़ी से चलाएँ                             |
| `npm run smoke:store`    | डेटाबेस स्कीमा और माइग्रेशन सुरक्षा सत्यापित करें                             |
| `npm run smoke:i18n`     | `default.json` स्कीमा के विरुद्ध अनुवाद कैटलॉग सत्यापित करें                  |
| `npm run i18n`           | सभी 10 भाषाओं में अनुवाद पूर्णता स्थिति रिपोर्ट करें                          |
| `npm run i18n:sync`      | अनुवाद कैटलॉग कुंजियों को `default.json` के साथ सिंक्रनाइज़ करें              |
| `npm run i18n:translate` | OpenRouter का उपयोग करके अनुपलब्ध कुंजियों का अनुवाद करें                     |
| `npm run format`         | Prettier से कोड फ़ॉर्मैट करें                                                 |
| `npm run format:check`   | कोड फ़ॉर्मैटिंग की जाँच करें                                                  |
| `npm run build:win`      | Windows निष्पादन योग्य फ़ाइल / इंस्टॉलर बनाएँ                                 |
| `npm run build:mac`      | macOS एप्लिकेशन बंडल बनाएँ                                                    |
| `npm run build:linux`    | Linux डिस्ट्रीब्यूशन पैकेज (AppImage, deb) बनाएँ                              |

## आर्किटेक्चर नोट्स

- **कॉन्टेक्स्ट आइसोलेशन सक्षम है** और `nodeIntegration` बंद है। रेंडरर मुख्य प्रक्रिया के साथ केवल [`src/preload`](src/preload/index.ts) में परिभाषित टाइप्ड `window.api` ब्रिज के माध्यम से संचार करता है।
- IPC हैंडलर [`src/main/ipc`](src/main/ipc/index.ts) में स्थित हैं। रेंडरर-फ़ेसिंग नई क्षमता जोड़ने के लिए वहाँ `ipcMain.handle(...)` रजिस्टर करें और प्रीलोड ब्रिज में मिलान करने वाला मेथड एक्सपोज़ करें।

### एजेंट हार्नेस

मुख्य प्रक्रिया एक एकल प्रदाता-स्वतंत्र एजेंट लूप चलाती है; रेंडरर केवल स्ट्रीम किए गए इवेंट प्राप्त करता है।

- **टूल लूप** — [`src/main/harness/agent.ts`](src/main/harness/agent.ts) टर्न लूप, टूल JSON-स्कीमा (`BASE_SCHEMAS`), कॉन्टेक्स्ट ट्रिमिंग और सबएजेंट डिस्पैच का प्रबंधन करता है। [`tools.ts`](src/main/harness/tools.ts) आधिकारिक `runTool` डिस्पैचर है। [`src/shared/tools.ts`](src/shared/tools.ts) में यूज़र-फ़ेसिंग कैटलॉग इसे प्रतिबिंबित करता है ("Skills & Tools" पृष्ठ) और साझा स्मोक सुइट द्वारा सुरक्षित है।
- **प्रदाता** — OpenAI/Copilot का हाथ से लिखा SSE पाथ (Copilot के अल्पकालिक टोकन रीफ़्रेश के साथ) [`services/llm.ts`](src/main/services/llm.ts) में है; Anthropic + Google को [`services/aisdk.ts`](src/main/services/aisdk.ts) में Vercel AI SDK के माध्यम से रूट किया जाता है ताकि प्रत्येक मॉडल परिवार को टूल-कॉलिंग मिल सके।
- **प्रॉम्प्ट्स व एजेंट** — मॉडल-विशिष्ट ट्यून किए गए प्रॉम्प्ट्स [`src/shared/prompt.ts`](src/shared/prompt.ts) में चुने जाते हैं और `resources/prompts/*.txt` से `?raw` के ज़रिए [`prompt-text.ts`](src/shared/prompt-text.ts) में इनलाइन किए जाते हैं। Plan/Build एजेंट और सबएजेंट [`src/shared/agents.ts`](src/shared/agents.ts) में परिभाषित हैं; एजेंट की `tools` अनुमति सूची और `promptFile` यह सुनिश्चित करते हैं कि Plan वास्तव में केवल-पठनीय रहे।
- **कॉन्टेक्स्ट प्रबंधन** — ओवरफ़्लो को मॉडल की वास्तविक सीमा के विरुद्ध मापा जाता है ([`src/shared/context.ts`](src/shared/context.ts)); बड़े टूल आउटपुट पूर्वावलोकन पॉइंटर के साथ डिस्क पर स्पिल होते हैं ([`services/tool-output-store.ts`](src/main/services/tool-output-store.ts)); पुराने टर्न्स को [`services/compaction.ts`](src/main/services/compaction.ts) द्वारा संक्षेपित किया जाता है।
- **इकोसिस्टम** — MCP क्लाइंट ([`services/mcp.ts`](src/main/services/mcp.ts)) के माध्यम से बाहरी टूल सर्वर, संपादन के बाद फ़ीडबैक किए जाने वाले भाषा-सर्वर डायग्नोस्टिक्स ([`services/lsp.ts`](src/main/services/lsp.ts)), और ऑन-डिमांड `SKILL.md` स्किल्स ([`services/skills.ts`](src/main/services/skills.ts))। Roxy का स्थायी ब्राउज़र टूलसेट ([`services/browser.ts`](src/main/services/browser.ts)) और आवर्ती अनुसूचित लूप्स ([`services/loops.ts`](src/main/services/loops.ts)) उसी लूप से चलते हैं।

### एकीकृत IDE और Git कार्यप्रवाह

- **फ़ाइल एडिटर व ट्री** — [`src/renderer/src/components/FileEditor.tsx`](src/renderer/src/components/FileEditor.tsx) Shiki द्वारा संचालित सिंटैक्स हाइलाइटिंग, सक्रिय फ़ाइल टैब और कॉन्टेक्स्ट अटैचमेंट के साथ इन-ऐप एडिटर प्रदान करता है।
- **Git क्रियाएँ और कॉन्फ़्लिक्ट सॉल्वर** — [`src/renderer/src/components/GitActionsView.tsx`](src/renderer/src/components/GitActionsView.tsx) और [`MergeConflictSolver.tsx`](src/renderer/src/components/MergeConflictSolver.tsx) विज़ुअल ब्रांच इतिहास, स्टेज़ किए गए बदलाव, डिफ़ निरीक्षण और 3-तरफ़ा मर्ज विरोध समाधान प्रस्तुत करते हैं।
- **टर्मिनल एमुलेटर** — `@xterm/xterm` और `node-pty` पर निर्मित, जिसके शेल सत्र [`src/main/services/shell-session.ts`](src/main/services/shell-session.ts) और [`src/renderer/src/components/TerminalView.tsx`](src/renderer/src/components/TerminalView.tsx) में प्रबंधित होते हैं।

### Live2D साथी और वॉइस सिंथेसिस

- **Live2D अवतार** — इंटरैक्टिव फ़िज़िक्स, एक्सप्रेशन ट्रिगर्स और ऑडियो लिप-सिंक के साथ [`Live2dCanvas.tsx`](src/renderer/src/components/Live2dCanvas.tsx) और [`VtuberStandalone.tsx`](src/renderer/src/components/VtuberStandalone.tsx) में Cubism Core द्वारा रेंडर किया गया।
- **RVC v2 इन्फ़्रेंस** — स्थानीय Python डेमन [`script/rvc_tts_server.py`](script/rvc_tts_server.py) edge-tts जेनरेशन को `RoxyMigurdia/` के चेकपॉइंट्स का उपयोग करके स्थानीय GPU पिच/टिम्ब्रे रूपांतरण के साथ जोड़ता है।
- **स्पीच-टू-टेक्स्ट (STT)** — [`src/main/services/stt.ts`](src/main/services/stt.ts) वॉइस प्रॉम्प्ट्स को कैप्चर करता है और faster-whisper ([`script/transcribe.py`](script/transcribe.py)) का उपयोग करके स्थानीय रूप से ट्रांसक्राइब करता है।

### रिमोट वर्कस्पेस

चल रहे सत्र को अपने फ़ोन पर ले जाएँ। **Remote Workspace** (साइडबार में नीचे बाईं ओर **CUSTOMIZE** समूह) एक कमरा बनाता है, QR कोड + सुरक्षित URL + PIN दिखाता है, और डेस्कटॉप को आधिकारिक होस्ट बनाए रखता है जबकि फ़ोन थिन क्लाइंट के रूप में काम करता है — **आपका कोड और फ़ाइलें कभी भी मशीन से बाहर नहीं जातीं**; केवल चैट ट्रांसक्रिप्ट और स्ट्रीम किए गए एजेंट इवेंट्स रिले होते हैं।

- **होस्ट सेवा** — [`main/services/remote.ts`](src/main/services/remote.ts) रिले पर सत्र बनाता है (`ROXY_REMOTE_BASE` के माध्यम से कॉन्फ़िगर, डिफ़ॉल्ट `https://roxy.schvis.com`), **होस्ट टोकन** रखता है, और एक स्थायी WebSocket बनाए रखता है। गेस्ट `hello` पर यह ट्रांसक्रिप्ट स्नैपशॉट भेजता है; गेस्ट `prompt` पर यह स्थानीय रूप से टर्न चलाता है, और प्रत्येक `LlmEvent` को फ़ोन और स्थानीय रेंडरर पर एक साथ स्ट्रीम करता है।
- **एक ही लूप, कोई विचलन नहीं** — स्थानीय `llm:start` IPC कॉल और रिमोट प्रॉम्प्ट दोनों [`main/services/session-turn.ts`](src/main/services/session-turn.ts) के `runSessionTurn` के माध्यम से निष्पादित होते हैं।
- **सुरक्षा** — बिना लॉगिन प्रमाणीकरण: URL फ्रैगमेंट के माध्यम से एक अल्पकालिक HMAC गेस्ट टोकन पारित किया जाता है और फ़ोन को डेस्कटॉप पर प्रदर्शित 6-अंकीय **PIN** प्रदान करना होता है। कमरे रोकने पर, बार-बार गलत PIN प्रयासों के बाद, या डेस्कटॉप डिस्कनेक्ट होने पर स्वतः रद्द हो जाते हैं।

<a id="translations"></a>

## अनुवाद

Roxy, English, 简体中文, हिन्दी, Español, العربية, Français, Português, Русский, Deutsch और 日本語 में उपलब्ध है। मूल भाषा बोलने वाले लोग इंटरफ़ेस को अधिक स्पष्ट और स्वाभाविक बनाने में मदद कर सकते हैं। इन भाषाओं में issues और pull request विवरण देना स्वागत योग्य है।

- अंग्रेज़ी स्रोत स्ट्रिंग्स [`src/renderer/src/locales/default.json`](src/renderer/src/locales/default.json) में हैं।
- अनुवाद कैटलॉग [`src/renderer/src/locales`](src/renderer/src/locales) में हैं।
- UI कॉपी संपादित करने या भाषा जोड़ने से पहले [स्थानीयकरण गाइड](AGENTS.md#user-facing-strings-live-in-defaultjson) देखें।
- कैटलॉग संरचना, प्लेसहोल्डर्स और इनलाइन मार्कअप को सत्यापित करने के लिए `npm run i18n` चलाएँ।

## लाइसेंस

[MIT](LICENSE) © Roxy.

यह प्रोजेक्ट [Roxy](https://github.com/roxy-gg/roxy) का एक फ़ोर्क है जो [opencode](https://github.com/sst/opencode) (यह भी MIT) पर आधारित है, और इस प्रोजेक्ट के अपने कॉपीराइट के साथ-साथ उनके कॉपीराइट को भी बनाए रखता है। विवरण के लिए [LICENSE](LICENSE) और [`resources/prompts/ATTRIBUTION.txt`](resources/prompts/ATTRIBUTION.txt) देखें।
