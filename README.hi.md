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

**डाउनलोड:** [https://roxy.gg](https://roxy.gg)

Roxy एक [Electron](https://www.electronjs.org/) ऐप है, जिसे **TypeScript** में लिखा गया है और जिसकी इंटरफ़ेस परत **React** पर आधारित है। इसकी मुख्य प्रक्रिया में पूरा एजेंट सिस्टम शामिल है: प्रदाता-स्वतंत्र टूल लूप, हर मॉडल के लिए अनुकूलित सिस्टम निर्देश, Plan/Build एजेंट और सबएजेंट, डिस्क-आधारित कॉन्टेक्स्ट प्रबंधन, MCP सर्वर, language-server डायग्नोस्टिक्स और `SKILL.md` स्किल्स।

## टेक्नोलॉजी स्टैक

| परत         | तकनीक                              |
| ----------- | ---------------------------------- |
| डेस्कटॉप    | Electron 33                        |
| बिल्ड       | electron-vite (Vite 5)             |
| इंटरफ़ेस    | React 18 + TypeScript              |
| स्टाइल      | Tailwind CSS v4                    |
| टूल कॉलिंग  | Vercel AI SDK (Anthropic + Google) |
| इंटीग्रेशन  | Model Context Protocol SDK         |
| स्टोरेज     | better-sqlite3                     |
| पैकेजिंग    | electron-builder                   |
| फ़ॉर्मैटिंग | Prettier                           |

## प्रोजेक्ट संरचना

```text
roxy/
├── build/                  # आइकन और अनुमतियों जैसे पैकेजिंग संसाधन
├── resources/              # ऐप के साथ भेजे जाने वाले स्थिर संसाधन
│   └── prompts/            # मॉडल और एजेंट के अनुसार निर्देश
├── src/
│   ├── main/               # Electron की मुख्य प्रक्रिया (Node.js)
│   │   ├── index.ts        # ऐप जीवनचक्र, विंडो और सर्विस स्टार्टअप
│   │   ├── harness/        # एजेंट लूप और टूल निष्पादन
│   │   ├── services/       # LLM, MCP, LSP, स्किल्स, ब्राउज़र और लूप्स
│   │   ├── db/             # better-sqlite3 स्कीमा, माइग्रेशन और रिपॉज़िटरी
│   │   └── ipc/            # इंटरफ़ेस और सर्विस के बीच IPC कनेक्शन
│   ├── preload/            # सुरक्षित window.api ब्रिज
│   ├── renderer/           # React ऐप (Chromium)
│   └── shared/             # प्रक्रियाओं के बीच साझा मॉड्यूल
├── test/                   # स्मोक और वैलिडेशन टेस्ट
├── electron.vite.config.ts # बिल्ड कॉन्फ़िगरेशन
└── electron-builder.yml    # डिस्ट्रीब्यूशन कॉन्फ़िगरेशन
```

## शुरुआत

```bash
# डिपेंडेंसी इंस्टॉल करें
npm install

# हॉट रीलोड के साथ डेवलपमेंट मोड चलाएँ
npm run dev
```

## उपयोगी स्क्रिप्ट

| स्क्रिप्ट             | विवरण                                       |
| --------------------- | ------------------------------------------- |
| `npm run dev`         | हॉट रीलोड के साथ ऐप शुरू करता है            |
| `npm run build`       | टाइप जाँचकर प्रोडक्शन बिल्ड बनाता है        |
| `npm run typecheck`   | main, preload और renderer के टाइप जाँचता है |
| `npm run smoke`       | साझा और Electron टेस्ट चलाता है             |
| `npm run format`      | Prettier से रिपॉज़िटरी फ़ॉर्मैट करता है     |
| `npm run build:win`   | Windows इंस्टॉलर बनाता है                   |
| `npm run build:mac`   | macOS ऐप बनाता है                           |
| `npm run build:linux` | Linux पैकेज (AppImage और deb) बनाता है      |

## आर्किटेक्चर

- कॉन्टेक्स्ट आइसोलेशन चालू है और `nodeIntegration` बंद है। इंटरफ़ेस केवल [`src/preload`](src/preload/index.ts) में परिभाषित टाइप्ड `window.api` ब्रिज के माध्यम से मुख्य प्रक्रिया से बात करता है।
- IPC हैंडलर [`src/main/ipc`](src/main/ipc/index.ts) में हैं। इंटरफ़ेस के लिए नई क्षमता जोड़ते समय वहीं `ipcMain.handle(...)` रजिस्टर करें और preload ब्रिज में संबंधित मेथड उपलब्ध कराएँ।

### एजेंट सिस्टम

मुख्य प्रक्रिया एक ही प्रदाता-स्वतंत्र एजेंट लूप चलाती है; इंटरफ़ेस केवल स्ट्रीम किए गए इवेंट प्राप्त करता है।

- **टूल लूप:** [`src/main/harness/agent.ts`](src/main/harness/agent.ts) टर्न, `BASE_SCHEMAS`, कॉन्टेक्स्ट ट्रिमिंग और सबएजेंट नियंत्रित करता है। [`tools.ts`](src/main/harness/tools.ts) में मुख्य `runTool` डिस्पैचर है।
- **प्रदाता:** OpenAI/Copilot का SSE इंटीग्रेशन [`services/llm.ts`](src/main/services/llm.ts) में है। Anthropic और Google, [`services/aisdk.ts`](src/main/services/aisdk.ts) के माध्यम से Vercel AI SDK का उपयोग करते हैं।
- **निर्देश और एजेंट:** [`src/shared/prompt.ts`](src/shared/prompt.ts) हर मॉडल के निर्देश चुनता है। Plan/Build एजेंट और सबएजेंट [`src/shared/agents.ts`](src/shared/agents.ts) में परिभाषित हैं।
- **कॉन्टेक्स्ट प्रबंधन:** [`src/shared/context.ts`](src/shared/context.ts) हर मॉडल की वास्तविक सीमा का ध्यान रखता है; बड़े आउटपुट डिस्क पर रखे जाते हैं और पुराने टर्न संक्षिप्त किए जाते हैं।
- **इकोसिस्टम:** MCP, LSP डायग्नोस्टिक्स, `SKILL.md` स्किल्स, स्थायी ब्राउज़र और आवर्ती लूप एक ही एजेंट सिस्टम का उपयोग करते हैं।

### रिमोट वर्कस्पेस

चल रहे सेशन को फ़ोन से जारी रखें। **Remote Workspace** roxy.gg पर एक रूम बनाता है, QR कोड, सुरक्षित URL और PIN दिखाता है, जबकि डेस्कटॉप मुख्य होस्ट बना रहता है। **आपका कोड और फ़ाइलें मशीन से बाहर नहीं जाते**; केवल बातचीत और एजेंट इवेंट रिले होते हैं।

- [`main/services/remote.ts`](src/main/services/remote.ts), `POST https://roxy.gg/api/remote/sessions` से सेशन बनाता है, होस्ट टोकन रखता है और WebSocket कनेक्शन चालू रखता है।
- स्थानीय और रिमोट अनुरोध दोनों [`main/services/session-turn.ts`](src/main/services/session-turn.ts) के `runSessionTurn` का उपयोग करते हैं, इसलिए उनका व्यवहार एक जैसा है।
- IPC API में `remote:start`, `remote:stop`, `remote:status` और `remote:state` इवेंट हैं। QR कोड डायलॉग [`renderer/src/components/RemoteWorkspaceDialog.tsx`](src/renderer/src/components/RemoteWorkspaceDialog.tsx) में है।
- शेयरिंग रोकने, बहुत अधिक गलत PIN, समय समाप्त होने या डेस्कटॉप डिस्कनेक्ट होने के बाद रूम रद्द कर दिया जाता है। प्रोटोकॉल के लिए [roxy.gg README](../roxy.gg/README.md#remote-workspace) देखें।

<a id="translations"></a>

## अनुवाद

Roxy, English, 简体中文, हिन्दी, Español, العربية, Français, Português, Русский, Deutsch और 日本語 में उपलब्ध है। मूल भाषा बोलने वाले लोग इंटरफ़ेस को अधिक स्पष्ट और स्वाभाविक बनाने में मदद कर सकते हैं। इन भाषाओं में issue और pull request का विवरण देना स्वागत योग्य है।

- अंग्रेज़ी स्रोत टेक्स्ट [`src/renderer/src/locales/default.json`](src/renderer/src/locales/default.json) में है।
- अनुवाद कैटलॉग [`src/renderer/src/locales`](src/renderer/src/locales) में हैं।
- इंटरफ़ेस टेक्स्ट बदलने या भाषा जोड़ने से पहले [लोकलाइज़ेशन गाइड](AGENTS.md#user-facing-strings-live-in-defaultjson) पढ़ें।
- संरचना, प्लेसहोल्डर और इनलाइन मार्कअप जाँचने के लिए `npm run i18n` चलाएँ।

## लाइसेंस

[MIT](LICENSE) © Roxy.

Roxy, [opencode](https://github.com/sst/opencode) का fork है, जो MIT लाइसेंस के अंतर्गत है। Roxy अपने copyright नोटिस के साथ opencode के नोटिस भी बनाए रखता है। अधिक जानकारी के लिए [LICENSE](LICENSE) और [`resources/prompts/ATTRIBUTION.txt`](resources/prompts/ATTRIBUTION.txt) देखें।
