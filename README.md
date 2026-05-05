# openai-realtime-test

[Live demo](https://vpalmisano.github.io/openai-realtime-test/)

A small Vue app for trying the [OpenAI Realtime API](https://platform.openai.com/docs/guides/realtime) over **WebRTC** or **WebSocket**. Configure model, voice, and transcription; chat by text or mic; optionally run scripted Q&A with [webrtcperf-js](https://github.com/vpalmisano/webrtcperf-js).

![Demo](docs/demo.png)

## Features

- **Transports**: WebSocket or WebRTC (with live peer-connection stats plots)
- **Session options**: model, voice, transcription model, and system instructions
- **Chat**: send text messages or speak via the microphone
- **Fake audio input**: play canned `.mp3` prompts from `public/audio/` and measure Q&A timing (start/end, latency, interruptions)
- **Save response audio**: download assistant replies as WAV
- **Tool demo**: sample `get_weather` function tool via `@openai/agents`
- Settings persist in `localStorage`

## Requirements

- Node.js 20+
- An [OpenAI API key](https://platform.openai.com/api-keys) with Realtime API access

## Quick start

```bash
npm install
npm run dev
```

Open the URL Vite prints (default `http://localhost:5173`), paste your API key, choose options, and click **Connect**.

### API key options

1. **UI field** — paste the key in the app (stored in `localStorage` as `apiKey`)
2. **Env var** — set `VITE_OPENAI_API_KEY` before starting Vite

## Usage

| Control                  | What it does                                                |
| ------------------------ | ----------------------------------------------------------- |
| **Transport**            | `websocket` or `webrtc`                                     |
| **Model**                | Realtime model id (default `gpt-realtime`)                  |
| **Voice**                | Assistant voice (e.g. `marin`, `alloy`, …)                  |
| **Transcription model**  | Input audio transcription                                   |
| **Context**              | System instructions for the agent                           |
| **Use fake audio input** | Override mic with scripted clips; shows audio-input buttons |
| **Save response audio**  | Write assistant PCM to WAV downloads                        |

With fake audio enabled and connected, click a prompt under **Audio inputs** to inject that clip as the microphone stream. Turn timing is logged in the messages panel.

## Scripts

| Command                           | Description                   |
| --------------------------------- | ----------------------------- |
| `npm run dev`                     | Dev server (`--host 0.0.0.0`) |
| `npm run build`                   | Typecheck + production build  |
| `npm run preview`                 | Preview the production build  |
| `npm run lint` / `lint:check`     | ESLint fix / check            |
| `npm run format` / `format:check` | Prettier write / check        |

## Stack

- Vue 3, Vite, TypeScript, Vuetify
- [`@openai/agents`](https://www.npmjs.com/package/@openai/agents) Realtime (WebRTC / WebSocket)
- [`@vpalmisano/webrtcperf-js`](https://www.npmjs.com/package/@vpalmisano/webrtcperf-js) for fake media, Q&A turns, and WebRTC plots
