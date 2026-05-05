import './style.css'
import { session } from './session.ts'

const TRANSPORTS = ['websocket', 'webrtc'] as const;
const VOICES = ['marin', 'cedar', 'alloy', 'ash', 'ballad', 'coral', 'echo', 'sage', 'shimmer', 'verse'] as const;
const TRANSCRIPTION_MODELS = ['gpt-4o-transcribe', 'gpt-4o-mini-transcribe', 'whisper-1'] as const;

declare const __QUESTIONS__: string[];
const QUESTIONS = __QUESTIONS__;

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <div>
    <h2>OpenAI Realtime</h2>
    <div class="controls">
      <div>
        <label for="apiKey">OpenAI API Key</label>
        <input id="apiKey" type="password" placeholder="OpenAI API Key" />
      </div>
      <div>
        <label for="model">Model</label>
        <input id="model" type="text" placeholder="Model" value="gpt-realtime" />
      </div>
      <div>
        <label for="transport">Transport</label>
        <select id="transport">
          ${TRANSPORTS.map(transport => `<option value="${transport}">${transport}</option>`).join('')}
        </select>
      </div>
      <div>
        <label for="voice">Voice</label>
        <select id="voice">
          ${VOICES.map(voice => `<option value="${voice}">${voice}</option>`).join('')}
        </select>
      </div>
      <div>
        <label for="transcriptionModel">Transcription Model</label>
        <select id="transcriptionModel">
          ${TRANSCRIPTION_MODELS.map(m => `<option value="${m}">${m}</option>`).join('')}
        </select>
      </div>
      <div>
      <label><input id="overrideGetUserMedia" type="checkbox" checked /> Override getUserMedia</label>
      <label><input id="saveResponseAudio" type="checkbox" /> Save response audio</label>
      <button id="connect" type="button">Connect</button>
      <button id="disconnect" type="button">Disconnect</button>
    </div>
    <div id="questionsSection">
      <b>Questions</b>
      <div class="questions">
        ${QUESTIONS.map(question => `<button class="question" data-name="${question}" type="button">${question.replace('.mp3', '')}</button>`).join('')}
      </div>
    </div>
    <div>
      <label for="context">Context (instructions)</label>
      <textarea id="context" rows="6" style="width: 90vw;">You help users create content for a website.

VOICE & TONE:
You are being HEARD, not read. Be conversational and natural — like a smart colleague talking through ideas.
- Keep responses SHORT. 1-2 sentences max for most replies. Only use 3 sentences if truly needed.
- Don't ramble or monologue. Say what's needed and stop.
- NEVER list things out loud. NEVER enumerate. NEVER say "first... second... third..."
- NEVER repeat back what the user just said. They know what they said.
- Think friendly colleague who's concise, not a presenter giving a speech.
- Do not change your voice or tone throughout the conversation.</textarea>
    </div>
    <div class="input">
      <input id="textInput" type="text" placeholder="Type a message..." style="width: 50vw;" />
      <button id="sendText" type="button">Send text</button>
    </div>
    <div>
      <textarea id="messages" rows="20" readonly style="width: 90vw;"></textarea>
    </div>
  </div>
`;

['apiKey', 'model', 'transport', 'voice', 'transcriptionModel', 'context'].forEach((id: string) => {
  const input = document.getElementById(id) as HTMLInputElement;
  const savedValue = localStorage.getItem(id);
  if (savedValue) {
    input.value = savedValue;
  }
  input.addEventListener('input', () => {
    localStorage.setItem(id, input.value);
  });
});

['overrideGetUserMedia', 'saveResponseAudio'].forEach((id: string) => {
  const input = document.getElementById(id) as HTMLInputElement;
  const savedValue = localStorage.getItem(id);
  if (savedValue !== null) {
    input.checked = savedValue === 'true';
  }
  input.addEventListener('change', () => {
    localStorage.setItem(id, String(input.checked));
  });
});

session(document.querySelector<HTMLDivElement>('#app')!)
