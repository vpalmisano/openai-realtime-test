

function createWavHeader(pcmLength: number, sampleRate: number, numChannels: number, bitsPerSample: number): ArrayBuffer {
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const header = new ArrayBuffer(44);
  const view = new DataView(header);

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + pcmLength, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeString(36, 'data');
  view.setUint32(40, pcmLength, true);

  return header;
}

export async function savePcm16AsWav(chunks: Int16Array[], sampleRate: number): Promise<string> {
  const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
  const merged = new Int16Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }

  const pcmBytes = new Uint8Array(merged.buffer);
  const header = createWavHeader(pcmBytes.byteLength, sampleRate, 1, 16);

  const root = await navigator.storage.getDirectory();
  const filename = `response-${Date.now()}.wav`;
  const fileHandle = await root.getFileHandle(filename, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(header);
  await writable.write(pcmBytes);
  await writable.close();

  console.log(`Saved ${filename} (${(pcmBytes.byteLength / 1024).toFixed(1)} KB PCM, ${(totalLength / sampleRate).toFixed(2)}s)`);
  return filename;
}
