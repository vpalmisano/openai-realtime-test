

export function floatTo16BitPCM(float32Array: Float32Array): Int16Array {
  const int16Array = new Int16Array(float32Array.length);
  for (let i = 0; i < float32Array.length; i++) {
    const s = Math.max(-1, Math.min(1, float32Array[i]));
    int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return int16Array;
}

export function pcm16ToFloat32(pcm16: Int16Array): Float32Array<ArrayBuffer> {
  const float32Array = new Float32Array(pcm16.length);
  for (let i = 0; i < pcm16.length; i++) {
    float32Array[i] = pcm16[i] / 0x8000;
  }
  return float32Array;
}

export async function resampleAudio(
  float32: Float32Array<ArrayBuffer>,
  numberOfFrames: number,
  sampleRate: number,
  targetSampleRate: number
) {
  const offlineCtx = new OfflineAudioContext(
    1,
    Math.ceil(numberOfFrames * targetSampleRate / sampleRate),
    targetSampleRate,
  );
  const buf = offlineCtx.createBuffer(1, numberOfFrames, sampleRate);
  buf.copyToChannel(float32, 0);
  const source = offlineCtx.createBufferSource();
  source.buffer = buf;
  source.connect(offlineCtx.destination);
  source.start(0);
  const rendered = await offlineCtx.startRendering();
  return rendered.getChannelData(0);
}
