import {
  RealtimeAgent,
  RealtimeSession,
  OpenAIRealtimeWebRTC,
  OpenAIRealtimeWebSocket,
} from '@openai/agents/realtime';
import type { OpenAIRealtimeModels } from '@openai/agents/realtime';
import { savePcm16AsWav } from './save';
import { getWeatherTool } from './tools';
import * as webrtcperf from '@vpalmisano/webrtcperf-js';
import { floatTo16BitPCM, pcm16ToFloat32, resampleAudio } from './utils';

type TransportType = 'webrtc' | 'websocket';

window.webrtcperf = webrtcperf;

async function createSession(
  transportType: TransportType = 'webrtc', 
  model: OpenAIRealtimeModels = 'gpt-realtime', 
  voice: string = 'alloy', 
  transcriptionModel: string = 'gpt-4o-transcribe', 
  apiKey?: string, 
  saveResponseAudio: boolean = false,
  context?: string,
  overrideGetUserMedia: boolean = true,
) {
  webrtcperf.params.overrideGetUserMedia = overrideGetUserMedia;

  const mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  let audioContext: AudioContext | null = null;
  let audioElement: HTMLAudioElement | null = null;

  const createTransport = () => {
    if (transportType === 'webrtc') {
      audioElement = document.createElement('audio');
      audioElement.autoplay = true;
      document.body.appendChild(audioElement);
      return new OpenAIRealtimeWebRTC({
        useInsecureApiKey: true,
        mediaStream,
        audioElement,
        baseUrl: `https://api.openai.com/v1/realtime?model=${model}`,
      });
    } 
    return new OpenAIRealtimeWebSocket({
      useInsecureApiKey: true,
      url: `wss://api.openai.com/v1/realtime?model=${model}`,
    });
  }

  const transport = createTransport();

  const agent = new RealtimeAgent({
    name: 'Assistant',
    instructions: context || 'You are a helpful assistant.',
    voice,
    tools: [getWeatherTool],
  });

  const session = new RealtimeSession(agent, { 
    model,
    transport,
    config: {
      audio: {
        input: {
          format: {
            rate: 24000,
            type: 'audio/pcm',
          },
          turnDetection: {
            type: 'semantic_vad',
            eagerness: 'medium',
            createResponse: true,
            interruptResponse: true,
          },
          transcription: {
            model: transcriptionModel,
          }
        },
        output: {
          format: {
            rate: 24000,
            type: 'audio/pcm',
          },
          voice,
        },
      },
      outputModalities: ['audio'],
    },
  });

  if (transportType === 'websocket') {
    const TARGET_SAMPLE_RATE = 24000;

    // Input.
    const track = mediaStream.getAudioTracks()[0];
    const { readable } = new window.MediaStreamTrackProcessor({ track })
    const writableStream = new window.WritableStream(
      {
        async write(frame: AudioData) {
          try {
            const { numberOfFrames, sampleRate } = frame;
            const float32 = new Float32Array(numberOfFrames);
            frame.copyTo(float32, { planeIndex: 0 });

            let pcm16: Int16Array;
            if (frame.sampleRate !== TARGET_SAMPLE_RATE) {
              const rendered = await resampleAudio(float32, numberOfFrames, sampleRate, TARGET_SAMPLE_RATE);
              pcm16 = floatTo16BitPCM(rendered);
            } else {
              pcm16 = floatTo16BitPCM(float32);
            }

            session.sendAudio(pcm16.buffer as ArrayBuffer);
          } finally {
            frame.close();
          }
        },
        close() {},
        abort() {},
      },
      new CountQueuingStrategy({ highWaterMark: 1 }),
    )
    readable
      .pipeTo(writableStream)
      .catch((err: unknown) => console.error(`[session] error: ${(err as Error).message}`))

    // Output.
    audioContext = new AudioContext({ 
      sampleRate: 24000,
      latencyHint: 'interactive',
    });
    if (audioContext.state === 'suspended') {
      await audioContext.resume();
    }
    
    const playQueue: Float32Array<ArrayBuffer>[] = [];
    let playingSource: AudioBufferSourceNode | null = null;

    const flushPlayQueue = async () => {
      playQueue.splice(0, playQueue.length);
      if (playingSource) {
        playingSource.disconnect();
        playingSource = null;
      }
    };

    const playNext = () => {
      if (playingSource || !audioContext) {
        return;
      }
      const float32 = playQueue.shift();
      if (!float32) {
        return;
      }

      const buffer = audioContext.createBuffer(1, float32.length, 24000);
      buffer.copyToChannel(float32, 0);

      playingSource = audioContext.createBufferSource();
      playingSource.buffer = buffer;
      playingSource.connect(audioContext.destination);
      playingSource.start();

      playingSource.onended = () => {
        if (playingSource) {
          playingSource.disconnect();
          playingSource = null;
        }
        playNext();
      };
    };

    let audioChunks: Int16Array[] = [];

    session.transport.on('response.output_audio.delta', (event) => {
      const { delta } = event;
      const binaryString = atob(delta);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      const pcm16 = new Int16Array(bytes.buffer);
      if (saveResponseAudio) {
        audioChunks.push(pcm16);
      }

      const float32 = pcm16ToFloat32(pcm16);
      playQueue.push(float32);
    
      playNext();
    });

    session.transport.on('response.output_audio.done', () => {
      if (audioChunks.length > 0) {
        const chunks = audioChunks;
        audioChunks = [];
        savePcm16AsWav(chunks, TARGET_SAMPLE_RATE).catch(console.error);
      }
    });

    session.transport.on('conversation.item.truncated', () => {
      flushPlayQueue();
    });

    session.transport.on('input_audio_buffer.speech_started', () => {
      audioChunks = [];
      flushPlayQueue();
    });
  }

  await session.connect({
    apiKey: apiKey || import.meta.env.VITE_OPENAI_API_KEY,
    model,
  });

  (window as any).session = session;

  const playAudio = async (url: string) => {
    webrtcperf.fakeStreamManager.muted = false
    webrtcperf.fakeStreamManager.volume = 1.0
    await webrtcperf.setMedia(url);
  };

  const stop = () => {
    session.interrupt();
    mediaStream.getTracks().forEach(track => track.stop());
    audioContext?.close();
    audioElement?.remove();
    session.close();
  };
  
  return { playAudio, session, stop };
}

export async function session(app: HTMLDivElement) {
  let session: RealtimeSession | null = null;
  let playAudio: (url: string) => Promise<void> = async () => {};
  let stop: () => void = () => {};

  const connectButton = app.querySelector<HTMLButtonElement>('#connect')!;
  const disconnectButton = app.querySelector<HTMLButtonElement>('#disconnect')!;
  const messages = app.querySelector<HTMLTextAreaElement>('#messages')!;
  const transportSelect = app.querySelector<HTMLSelectElement>('#transport');
  const modelSelect = app.querySelector<HTMLSelectElement>('#model');
  const voiceSelect = app.querySelector<HTMLSelectElement>('#voice');
  const transcriptionModelSelect = app.querySelector<HTMLSelectElement>('#transcriptionModel');
  const apiKeyInput = app.querySelector<HTMLInputElement>('#apiKey');
  const contextInput = app.querySelector<HTMLTextAreaElement>('#context');
  const overrideGetUserMediaCheckbox = app.querySelector<HTMLInputElement>('#overrideGetUserMedia');
  const questionsSection = app.querySelector<HTMLDivElement>('#questionsSection')!;
  const questionButtons = app.querySelectorAll<HTMLButtonElement>('button.question');
  const textInput = app.querySelector<HTMLInputElement>('#textInput')!;
  const sendTextButton = app.querySelector<HTMLButtonElement>('#sendText')!;

  const updateQuestionsVisibility = () => {
    questionsSection.style.display = overrideGetUserMediaCheckbox?.checked ? '' : 'none';
  };
  updateQuestionsVisibility();
  overrideGetUserMediaCheckbox?.addEventListener('change', updateQuestionsVisibility);

  const appendMessage = (text: string) => {
    messages.value += text;
    messages.scrollTop = messages.scrollHeight;
  };

  const setConnected = (connected: boolean) => {
    connectButton.disabled = connected;
    disconnectButton.disabled = !connected;
    sendTextButton.disabled = !connected;
    textInput.disabled = !connected;
    questionButtons.forEach(b => b.disabled = !connected);
  };

  setConnected(false);

  let playEnded = 0;

  questionButtons.forEach((button) => {
    const name = button.dataset.name;
    button.addEventListener('click', () => {
      if (playAudio) {
        appendMessage(`> Playing audio ${name}\n`);
        playAudio(`./audio/${name}`)
        .then(() => {
          appendMessage(`> Audio ${name} played\n`);
          playEnded = performance.now();
        })
        .catch(error => {
          appendMessage(`> Error playing audio ${name}: ${error}\n`);
        });
      }
    });
  });

  sendTextButton.addEventListener('click', () => {
    if (session && textInput.value.trim()) {
      const text = textInput.value.trim();
      appendMessage(`> Sending: "${text}"\n`);
      session.sendMessage(text);
      textInput.value = '';
    }
  });

  connectButton.addEventListener('click', async () => {
    const transportType = (transportSelect?.value as TransportType) || 'webrtc';
    const model = (modelSelect?.value as OpenAIRealtimeModels) || 'gpt-realtime';
    const voice = voiceSelect?.value || 'alloy';
    const transcriptionModel = transcriptionModelSelect?.value || 'gpt-4o-transcribe';
    appendMessage(`Connecting via ${transportType} with model ${model}, voice ${voice}, transcription ${transcriptionModel}...\n`);
    const startTime = performance.now();
    const apiKey = apiKeyInput?.value?.trim() || undefined;
    const context = contextInput?.value?.trim() || undefined;
    const overrideGUM = overrideGetUserMediaCheckbox?.checked ?? true;
    const ret = await createSession(transportType, model, voice, transcriptionModel, apiKey, false, context, overrideGUM);
    session = ret.session;
    playAudio = ret.playAudio;
    stop = ret.stop;
    appendMessage(`Connected in ${Math.round(performance.now() - startTime)}ms\n`);
    setConnected(true);
    session.on('*', (event) => {
      console.log('session event', event);
    });
    session.transport.on('*', (event) => {
      console.log(`transport ${event.type} item_id: ${(event as any).item_id}`, event);
      const ts = Math.round(performance.now() - playEnded);
      switch (event.type) {
        case 'conversation.item.added':
          appendMessage(`[${ts}] Conversation item added\n`);
          break;
        case 'response.created':
          appendMessage(`[${ts}] Response created\n`);
          break;
        case 'conversation.item.input_audio_transcription.completed':
          appendMessage(`[${ts}] Input audio transcription: "${event?.transcript}"\n`);
          break;
        case 'response.output_item.done':
          appendMessage(`[${ts}] Response output item done: "${event.item.content?.map((c: any) => c.transcript)}"\n`);
          break;
        case 'response.function_call_arguments.done':
          appendMessage(`[${ts}] Tool call: ${event.name || ''}(${event.arguments})\n`);
          break;
        default:
          break;
      }
    });
  });
  disconnectButton.addEventListener('click', () => {
    if (session) {
      appendMessage('Disconnected\n');
      stop();
      session = null;
      playAudio = async () => {};
      stop = () => {};
      setConnected(false);
    }
  });
}
