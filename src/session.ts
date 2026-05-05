import {
  RealtimeAgent,
  RealtimeSession,
  OpenAIRealtimeWebRTC,
  OpenAIRealtimeWebSocket,
} from '@openai/agents/realtime';
import type { OpenAIRealtimeModels } from '@openai/agents/realtime';
import { getWeatherTool } from './tools';
import * as webrtcperf from '@vpalmisano/webrtcperf-js';
import { floatTo16BitPCM, pcm16ToFloat32, resampleAudio } from './utils';

export type TransportType = 'webrtc' | 'websocket';

async function createEphemeralClientSecret(apiKey: string, model: string): Promise<string> {
  const response = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      session: {
        type: 'realtime',
        model,
      },
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Failed to create realtime client secret (${response.status}): ${detail}`);
  }

  const data = (await response.json()) as { value?: string };
  if (!data.value) {
    throw new Error('Realtime client secret response did not include a value');
  }
  return data.value;
}

export async function createSession(
  transportType: TransportType = 'webrtc',
  model: OpenAIRealtimeModels = 'gpt-realtime',
  voice: string = 'alloy',
  transcriptionModel: string = 'gpt-4o-transcribe',
  apiKey?: string,
  saveResponseAudio: boolean = false,
  context?: string,
  overrideGetUserMedia: boolean = true,
  qaTurnCallback?: ((turn: webrtcperf.QuestionAnswerTurn) => Promise<void>) | undefined,
) {
  webrtcperf.params.overrideGetUserMedia = overrideGetUserMedia;

  const resolvedApiKey = apiKey || import.meta.env.VITE_OPENAI_API_KEY;
  if (!resolvedApiKey) {
    throw new Error('OpenAI API key is required');
  }

  const mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const sourceAudioTrack = mediaStream.getAudioTracks()[0];
  let outputAudioTrack: MediaStreamTrack | null = null;
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
      });
    }
    return new OpenAIRealtimeWebSocket({
      useInsecureApiKey: true,
      url: `wss://api.openai.com/v1/realtime?model=${model}`,
    });
  };

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
          },
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
    const { readable } = new window.MediaStreamTrackProcessor({ track: sourceAudioTrack });
    const writableStream = new window.WritableStream(
      {
        async write(frame: AudioData) {
          try {
            const { numberOfFrames, sampleRate } = frame;
            const float32 = new Float32Array(numberOfFrames);
            frame.copyTo(float32, { planeIndex: 0 });

            let pcm16: Int16Array;
            if (frame.sampleRate !== TARGET_SAMPLE_RATE) {
              const rendered = await resampleAudio(
                float32,
                numberOfFrames,
                sampleRate,
                TARGET_SAMPLE_RATE,
              );
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
    );
    readable
      .pipeTo(writableStream)
      .catch((err: unknown) => console.error(`[session] error: ${(err as Error).message}`));

    // Output.
    audioContext = new AudioContext({
      sampleRate: 24000,
      latencyHint: 'interactive',
    });
    if (audioContext.state === 'suspended') {
      await audioContext.resume();
    }
    const destination = audioContext.createMediaStreamDestination();
    outputAudioTrack = destination.stream.getAudioTracks()[0];
    const keepAlive = audioContext.createConstantSource();
    keepAlive.offset.value = 0;
    keepAlive.connect(destination);
    keepAlive.start();

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
      playingSource.connect(destination);
      playingSource.start();

      playingSource.onended = () => {
        if (playingSource) {
          playingSource.disconnect();
          playingSource = null;
        }
        playNext();
      };
    };

    session.transport.on('response.output_audio.delta', event => {
      const { delta } = event;
      const binaryString = atob(delta);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      const pcm16 = new Int16Array(bytes.buffer);
      const float32 = pcm16ToFloat32(pcm16);
      playQueue.push(float32);

      playNext();
    });

    session.transport.on('conversation.item.truncated', () => {
      flushPlayQueue();
    });

    session.transport.on('input_audio_buffer.speech_started', () => {
      flushPlayQueue();
    });
  }

  const connectApiKey = await createEphemeralClientSecret(resolvedApiKey, model);

  await session.connect({
    apiKey: connectApiKey,
    model,
  });

  if (transportType === 'webrtc') {
    outputAudioTrack = await webrtcperf.getTransceiversTrack('recv', 'audio');
  }

  (window as unknown as Window & { session: RealtimeSession }).session = session;

  if (saveResponseAudio && outputAudioTrack) {
    webrtcperf.overrides.getParticipantNameForSave = () => 'recv';
    await webrtcperf.saveMediaTrack(outputAudioTrack, 'recv');
  }

  const stopEstimateQuestionAnswerDelay = webrtcperf.estimateQuestionAnswerDelay(
    sourceAudioTrack,
    outputAudioTrack!,
    40,
    1000,
    qaTurnCallback,
  );

  const playAudio = async (url: string) => {
    webrtcperf.fakeStreamManager.muted = false;
    webrtcperf.fakeStreamManager.volume = 1.0;
    await webrtcperf.setMedia(url);
  };

  const stop = () => {
    if (saveResponseAudio && outputAudioTrack) {
      webrtcperf.stopSaveMediaTrack(outputAudioTrack);
      webrtcperf
        .downloadMediaFromStorage('recv.wav')
        .then(() => webrtcperf.deleteMediaFromStorage('recv.wav'))
        .catch(console.error);
    }
    stopEstimateQuestionAnswerDelay?.();
    session.interrupt();
    mediaStream.getTracks().forEach(track => track.stop());
    audioContext?.close();
    audioElement?.remove();
    session.close();
  };

  return { playAudio, session, stop };
}
