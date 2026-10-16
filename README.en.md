# frame

**A companion you can talk to, and an agent that actually gets things done.**

Talk into your mic, it answers in real time. It has a personality. It remembers things about you. And when you need it to, it can really do stuff — check the time, do the math, search the web, read a link you hand it.

Bring your own API key. Voice, persona, memory and execution all live in one project. `npm run dev` and you're up.

[![CI](https://github.com/ghl872954-glitch/frame-ai/actions/workflows/ci.yml/badge.svg)](https://github.com/ghl872954-glitch/frame-ai/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-2ee6c5.svg)](LICENSE)

[中文](README.md) · [Design doc](DESIGN.md) · [Architecture](docs/ARCHITECTURE.md) · [Privacy](docs/PRIVACY.md) · [Security](SECURITY.md)

![Main screen](docs/home-dark.png)

---

## What it is

- **Real-time voice.** No push-to-talk. Just start talking, and cut it off mid-sentence whenever you want.
- **A stable persona.** A few presets, or write your own. Turn it off for a plain assistant.
- **Memory.** It remembers your preferences and habits. You can see, delete and export every single item.
- **It executes tasks.** Time, arithmetic, remembering things, fetching pages, searching the web. Five permission levels — you decide how far it reaches.
- **Your own key.** Ten provider presets, Chinese and global. Any OpenAI-compatible gateway works.
- **Bilingual UI, dark and light themes.**

## What it does not do

This isn't a disclaimer. It's enforced in code.

- **It never deletes anything on your device.**
- **It never overwrites existing content.** Writes are create-only or append-only.
- **No always-on listening. No talking first.** If you're quiet, it stays quiet.
- **No quiet uploads.** Your API key lives in your browser and nowhere else.

---

## Quick start

Requires **Node.js 20.9 or newer**.

```bash
git clone https://github.com/ghl872954-glitch/frame-ai.git
cd frame-ai
npm install
npm run dev
```

Open http://localhost:3000, click the gear icon in the top right, and go to the **Model** tab:

1. Pick a provider
2. Click "Get a key", grab one, paste it back
3. Click "Test connection" — when it says it works, you're done

Back on the main screen, tap the circle and start talking. Or just type below it.

> Want it fully offline? Pick **Ollama (local)**. The model runs on your own machine; nothing leaves it.

---

## Supported providers

| Provider | Region | Chat | STT | TTS |
| --- | --- | --- | --- | --- |
| SiliconFlow | China | ✅ | ✅ | ✅ |
| DeepSeek | China | ✅ | — | — |
| Alibaba Bailian | China | ✅ | — | — |
| Zhipu GLM | China | ✅ | — | — |
| Moonshot Kimi | China | ✅ | — | — |
| OpenAI | Global | ✅ | ✅ | ✅ |
| Groq | Global | ✅ | ✅ | — |
| OpenRouter | Global | ✅ | — | — |
| Ollama | Local | ✅ | — | — |
| Custom | — | ✅ | ✅ | ✅ |

A dash doesn't mean that provider is unusable. See the next section.

Every field is editable in the UI, and the model list can be pulled straight from the provider — model names change faster than docs do, so hardcoding them ages badly.

---

## Why voice works even if your model doesn't do voice

This is the central design decision.

You might be pointing it at DeepSeek, a text-only model. If voice were bolted onto the chat model, you'd be out of luck — which is how most projects in this space work.

frame splits voice into three independent layers:

```
Mic → VAD → STT → LLM → TTS → Speaker
              ↑     ↑     ↑
              └─────┴─────┘
      three swappable layers, freely mixed
```

On startup it picks the best tier your environment supports:

| Tier | Condition | Result |
| --- | --- | --- |
| ① Native realtime | Endpoint speaks a realtime voice protocol | Lowest latency |
| ② Cloud cascade | Cloud STT and TTS are configured | Best quality |
| ③ Browser built-in | Everything else (the default today) | Zero setup, Chrome / Edge |
| ④ Text only | Browser has no speech APIs | Type, read answers as captions |

**So even with a text-only model, voice still works** — it drops to tier ③ and uses the browser's own recognition and synthesis.

The same idea applies to tool calling. It doesn't rely on native function calling (which only some models support). Instead the tool list goes into the prompt and the model replies with a fenced code block. **Any model can execute tasks.**

---

## Safety design

"Never deletes anything important on your device" is implemented in three stacked layers, not one rule.

**Layer 1 · Physical.** The executor simply **has no delete or overwrite function**. A function that doesn't exist can't be reached by any config, any approval, any model request. Rules can be worked around; missing functions cannot.

**Layer 2 · Static.** A regex table living in code. A hit is refused outright — no confirmation dialog, nothing. It covers seven categories: deletion, overwriting, privilege escalation, persistence, remote execution, system damage, and reading secrets. Quoted content is stripped before scanning, so `echo "rm -rf /"` doesn't trip it.

**Layer 3 · Authorization.** Capabilities are graded, and you choose how far to open them.

| Level | What | Default |
| --- | --- | --- |
| L0 | Time, math, charts, memory writes | Allowed |
| L1 | Web search, page fetching | Allowed, can be turned off |
| L2 | Read this machine: list, read files, read clipboard | Ask on first use |
| L3 | Write this machine: create, append, open apps, write clipboard | Ask every time |
| L4 | Run commands, make network requests | Ask every time, full text shown |
| L5 | Delete, overwrite, escalate, damage the system | **Never** |

The red line beats everything. Even if you flip a capability to "always allow", an action that hits the red line is still refused.

![Safety settings](docs/safety-dark.png)

Every tool call leaves an entry in the **Safety** tab: what was called, with what arguments, and what came back.

---

## Built-in tools

| Tool | What it does | Level |
| --- | --- | --- |
| `get_time` | Current date and time | L0 |
| `calculate` | Arithmetic. `+ - * / % ^`, parentheses, and `sqrt/abs/round/min/max/log` | L0 |
| `remember` | Remember a fact about you | L0 |
| `fetch_url` | Fetch and extract a page's text | L1 |
| `web_search` | Search the web | L1 |

The calculator is a **hand-written lexer and recursive-descent parser**. It deliberately avoids `eval` / `new Function` — that would be shipping an arbitrary code execution hole as a feature.

`fetch_url` has SSRF protection: loopback addresses, private ranges and the cloud metadata endpoint (`169.254.169.254`) are blocked by default. When running locally you can open up localhost so it can reach your own Ollama instance.

---

## Project layout

```
frame/
├─ src/
│  ├─ app/
│  │  ├─ page.tsx            Main screen (minimal / expanded)
│  │  ├─ layout.tsx          Metadata
│  │  ├─ icon.svg            Icon: a frame with a dot in it
│  │  ├─ globals.css         Design system: two token sets + geometric motif
│  │  └─ api/                chat proxy / model list / fetch / health
│  ├─ components/            Voice orb, transcript, composer, settings, confirm dialog
│  ├─ i18n/                  zh + en dictionaries (a missing en key fails the build)
│  └─ lib/
│     ├─ voice/              Tier routing, browser adapters, sentence buffer, session state
│     ├─ tools/              Graded policy, red lines, calculator, protocol parsing, stream filter
│     ├─ agent.ts            One full turn
│     ├─ memory.ts           Three-layer memory
│     └─ store.ts            Global state
├─ tests/                    Vitest, 203 cases
├─ docs/
│  ├─ ARCHITECTURE.md        How data flows, what each module owns
│  └─ PRIVACY.md             Where every kind of data actually goes
├─ .github/                  CI, issue templates, PR template, dependency updates
├─ DESIGN.md                 Full design document (Chinese)
├─ SECURITY.md               How to report, and the trade-offs we accepted
└─ CONTRIBUTING.md           Three hard rules + code style (Chinese)
```

**Zero runtime dependencies**: just next, react and zustand. Styling is hand-written CSS variables — no Tailwind.

---

## Development

```bash
npm run dev        # dev server
npm run build      # production build
npm run lint       # ESLint
npm run test       # unit tests
npm run typecheck  # type check
npm run check      # lint + types + tests — run this before pushing
```

Tests cover the parts most likely to break and most worth pinning down: tier routing, the voice session and interruption, sentence splitting, streaming tool-block filtering, red-line rules, the calculator, protocol parsing, memory de-duplication, config repair, and a full conversation turn end to end.

**No environment variables to configure.** Your API key lives in the browser; nothing is written to disk on the server.

---

## Troubleshooting

**`npm test` fails with `Cannot find module @rollup/rollup-win32-x64-msvc`**

A known npm bug ([npm/cli#4828](https://github.com/npm/cli/issues/4828)) where it occasionally skips optional platform dependencies. Delete `node_modules` and `package-lock.json` and reinstall — if it still happens, install them explicitly:

```bash
npm install --no-save @rollup/rollup-win32-x64-msvc @esbuild/win32-x64
```

**Tapping the circle does nothing, or it can't get the microphone**

The browser needs mic permission — check the icon on the left of the address bar. Also, microphone access requires `localhost` or `https`; visiting over a bare IP won't work.

**Voice doesn't work in Firefox**

Firefox hasn't implemented the Web Speech API. Use Chrome or Edge, or just type — everything works in text mode.

**It hears its own voice as mine**

Common when using speakers. Headphones are the easy fix, or turn off "Allow interrupting" in the **Voice** tab.

**Can't reach the model service**

Open the **Model** tab and hit "Test connection" — it tells you the actual reason (bad key, no balance, wrong URL, stale model name). You can also pull the real model list straight from the provider.

---

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) first (it's in Chinese). It lists **three hard rules**:

1. No file-deletion features, ever
2. The red line is never made configurable
3. No `eval` / `new Function` / dynamic code execution

Those matter more than features. A PR that breaks them won't be merged, however useful it is.

Found a security issue — especially a way around the red line? Use the private channel described in [SECURITY.md](SECURITY.md), not a public issue.

---

## License

MIT
