<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import type { OpenAIRealtimeModels, RealtimeSession } from '@openai/agents/realtime';
import { createSession, type TransportType } from './session';
import * as webrtcperf from '@vpalmisano/webrtcperf-js';

window.webrtcperf = webrtcperf;

const TRANSPORTS = ['websocket', 'webrtc'] as const;
const VOICES = [
  'marin',
  'cedar',
  'alloy',
  'ash',
  'ballad',
  'coral',
  'echo',
  'sage',
  'shimmer',
  'verse',
] as const;
const TRANSCRIPTION_MODELS = ['gpt-4o-transcribe', 'gpt-4o-mini-transcribe', 'whisper-1'] as const;
const QUESTIONS = __QUESTIONS__;

const DEFAULT_CONTEXT = 'You help users answering questions.';

function loadString(key: string, fallback: string) {
  return localStorage.getItem(key) ?? fallback;
}

function loadBool(key: string, fallback: boolean) {
  const saved = localStorage.getItem(key);
  return saved === null ? fallback : saved === 'true';
}

const apiKey = ref(loadString('apiKey', ''));
const model = ref(loadString('model', 'gpt-realtime'));
const transport = ref<TransportType>(loadString('transport', 'websocket') as TransportType);
const voice = ref<(typeof VOICES)[number]>(
  (VOICES as readonly string[]).includes(loadString('voice', 'marin'))
    ? (loadString('voice', 'marin') as (typeof VOICES)[number])
    : 'marin',
);
const transcriptionModel = ref<(typeof TRANSCRIPTION_MODELS)[number]>(
  (TRANSCRIPTION_MODELS as readonly string[]).includes(
    loadString('transcriptionModel', 'gpt-4o-transcribe'),
  )
    ? (loadString(
        'transcriptionModel',
        'gpt-4o-transcribe',
      ) as (typeof TRANSCRIPTION_MODELS)[number])
    : 'gpt-4o-transcribe',
);
const context = ref(loadString('context', DEFAULT_CONTEXT));
const overrideGetUserMedia = ref(loadBool('overrideGetUserMedia', false));
const saveResponseAudio = ref(loadBool('saveResponseAudio', false));
const textInput = ref('');
const messages = ref('');
const connected = ref(false);
const connecting = ref(false);
const messagesField = ref<{ $el?: HTMLElement } | null>(null);
const plotsEl = ref<HTMLElement | null>(null);

let session: RealtimeSession | null = null;
let playAudio: (url: string) => Promise<void> = async () => {};
let stop: () => void = () => {};
let startTime = 0;

const showQuestions = computed(() => overrideGetUserMedia.value);

watch(apiKey, v => localStorage.setItem('apiKey', v));
watch(model, v => localStorage.setItem('model', v));
watch(transport, v => localStorage.setItem('transport', v));
watch(voice, v => localStorage.setItem('voice', v));
watch(transcriptionModel, v => localStorage.setItem('transcriptionModel', v));
watch(context, v => localStorage.setItem('context', v));
watch(overrideGetUserMedia, v => localStorage.setItem('overrideGetUserMedia', String(v)));
watch(saveResponseAudio, v => localStorage.setItem('saveResponseAudio', String(v)));

async function appendMessage(text: string) {
  const ts = startTime > 0 ? Math.round(performance.now() - startTime) / 1000 : 0;
  messages.value += `${ts > 0 ? `[${ts}] ` : ''}${text}`;
  await nextTick();
  const textarea = messagesField.value?.$el?.querySelector('textarea');
  if (textarea) {
    textarea.scrollTop = textarea.scrollHeight;
  }
}

async function qaTurnCallback(turn: webrtcperf.QuestionAnswerTurn) {
  console.log('qaTurnCallback', turn);
  let msg = turn.mediaFile ? `"${turn.mediaFile}" ` : '';
  const {
    questionStartTime,
    questionEndTime,
    answerStartTime,
    answerEndTime,
    answerTalkingAfterInterruption,
  } = turn;
  switch (turn.phase) {
    case 'question-start':
      msg += `question start`;
      break;
    case 'question-end':
      msg += `question duration: ${(questionEndTime - questionStartTime) / 1000}s`;
      break;
    case 'answer-start':
      msg += `question/answer delay: ${(answerStartTime - questionEndTime) / 1000}s`;
      break;
    case 'answer-end':
      msg += `answer duration: ${(answerEndTime - answerStartTime) / 1000}s`;
      break;
    case 'answer-interrupted':
      if (answerTalkingAfterInterruption) {
        msg += `answer interrupted, talking after interruption for ${answerTalkingAfterInterruption / 1000}s`;
      } else {
        msg += `answer interrupted`;
      }
      break;
  }
  await appendMessage(`${msg}\n`);
}

async function onConnect() {
  if (connecting.value || connected.value) return;
  connecting.value = true;
  try {
    await appendMessage(
      `Connecting via ${transport.value} with model ${model.value}, voice ${voice.value}, transcription ${transcriptionModel.value}...\n`,
    );
    startTime = performance.now();
    const ret = await createSession(
      transport.value,
      (model.value as OpenAIRealtimeModels) || 'gpt-realtime',
      voice.value || 'alloy',
      transcriptionModel.value || 'gpt-4o-transcribe',
      apiKey.value.trim() || undefined,
      saveResponseAudio.value,
      context.value.trim() || undefined,
      overrideGetUserMedia.value,
      qaTurnCallback,
    );
    session = ret.session;
    playAudio = ret.playAudio;
    stop = ret.stop;
    await appendMessage(`Connected in ${Math.round(performance.now() - startTime)}ms\n`);
    connected.value = true;

    session.on('*', event => {
      console.log('session event', event);
    });
    session.transport.on('*', event => {
      const itemId = 'item_id' in event ? event.item_id : undefined;
      console.log(`transport ${event.type} item_id: ${itemId}`, event);
    });

    if (plotsEl.value && transport.value === 'webrtc') {
      webrtcperf.plotPeerConnectionStats({
        intervalMs: 1000,
        container: plotsEl.value,
        enabledStats: [
          'outbound_audio_bitrate',
          'outbound_audio_packetsLossRate',
          'outbound_audio_roundTripTime',
          'inbound_audio_bitrate',
          'inbound_audio_packetsLossRate',
          'inbound_audio_jitterBuffer',
          'inbound_audio_insertedSamplesForDeceleration',
          'inbound_audio_removedSamplesForAcceleration',
        ],
      });
    }
  } catch (error) {
    await appendMessage(`> Connect error: ${error}\n`);
  } finally {
    connecting.value = false;
  }
}

function onDisconnect() {
  if (!session) return;
  appendMessage('Disconnected\n');
  stop();
  session = null;
  playAudio = async () => {};
  stop = () => {};
  connected.value = false;
  startTime = 0;
  webrtcperf.stopPlottingPeerConnectionStats();
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => onDisconnect());
}
window.addEventListener('beforeunload', onDisconnect);

function onSendText() {
  const text = textInput.value.trim();
  if (!session || !text) return;
  appendMessage(`Sending: "${text}"\n`);
  session.sendMessage(text);
  textInput.value = '';
}

function onPlayQuestion(name: string) {
  playAudio(`./audio/${name}`).catch(error =>
    appendMessage(`Error playing audio ${name}: ${error}\n`),
  );
}
</script>

<template>
  <v-app>
    <v-main>
      <v-container class="py-6" fluid>
        <div class="d-flex align-center justify-space-between mb-4">
          <h2 class="text-h5">OpenAI Realtime Test</h2>
          <v-btn
            icon="mdi-github"
            variant="text"
            href="https://github.com/vpalmisano/openai-realtime-test"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="GitHub repository"
          />
        </div>

        <v-row>
          <v-col cols="12" md="6" lg="4">
            <v-text-field
              v-model="apiKey"
              label="OpenAI API Key"
              type="password"
              variant="outlined"
              density="comfortable"
              hide-details
            />
          </v-col>
          <v-col cols="12" md="6" lg="4">
            <v-text-field
              v-model="model"
              label="Model"
              variant="outlined"
              density="comfortable"
              hide-details
            />
          </v-col>
          <v-col cols="12" md="6" lg="4">
            <v-select
              v-model="transport"
              :items="[...TRANSPORTS]"
              label="Transport"
              variant="outlined"
              density="comfortable"
              hide-details
            />
          </v-col>
          <v-col cols="12" md="6" lg="4">
            <v-select
              v-model="voice"
              :items="[...VOICES]"
              label="Voice"
              variant="outlined"
              density="comfortable"
              hide-details
            />
          </v-col>
          <v-col cols="12" md="6" lg="4">
            <v-select
              v-model="transcriptionModel"
              :items="[...TRANSCRIPTION_MODELS]"
              label="Transcription Model"
              variant="outlined"
              density="comfortable"
              hide-details
            />
          </v-col>

          <v-col cols="12" md="6" lg="4">
            <v-textarea
              v-model="context"
              label="Context (instructions)"
              variant="outlined"
              rows="1"
              hide-details
            />
          </v-col>
        </v-row>

        <div class="d-flex flex-wrap ga-4 align-center my-4">
          <v-checkbox
            v-model="overrideGetUserMedia"
            label="Use fake audio input"
            hide-details
            density="compact"
          />
          <v-checkbox
            v-model="saveResponseAudio"
            label="Save response audio"
            hide-details
            density="compact"
          />
          <v-btn color="primary" :loading="connecting" v-if="!connected" @click="onConnect">
            Connect
          </v-btn>
          <v-btn color="error" variant="tonal" v-if="connected" @click="onDisconnect">
            Disconnect
          </v-btn>
        </div>

        <div v-if="showQuestions" class="mb-4">
          <div class="text-subtitle-1 font-weight-bold mb-2">Audio inputs</div>
          <div class="d-flex flex-wrap ga-2">
            <v-btn
              v-for="question in QUESTIONS"
              :key="question"
              size="small"
              variant="outlined"
              :disabled="!connected"
              @click="onPlayQuestion(question)"
            >
              {{ question.replace('.mp3', '') }}
            </v-btn>
          </div>
        </div>

        <v-textarea
          ref="messagesField"
          v-model="messages"
          label="Messages"
          variant="outlined"
          rows="10"
          readonly
          hide-details
          class="messages-log"
        />

        <div class="d-flex flex-wrap ga-2 mb-4">
          <v-text-field
            v-model="textInput"
            label="Type a message..."
            variant="outlined"
            density="comfortable"
            hide-details
            class="flex-grow-1"
            :disabled="!connected"
            @keyup.enter="onSendText"
          />
          <v-btn color="primary" :disabled="!connected" @click="onSendText"> Send text </v-btn>
        </div>

        <div ref="plotsEl" class="d-flex flex-wrap ga-2 mb-4" id="webrtcperf-plots"></div>
      </v-container>
    </v-main>
  </v-app>
</template>

<style scoped>
.messages-log :deep(textarea) {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.875rem;
}
</style>
