export const WAV_HEADER_SIZE = 44

export function buildWav(pcmChunks: ArrayBuffer[], sampleRate: number, bitsPerSample: number, numChannels: number): Blob {
  const totalPcmSize = pcmChunks.reduce((s, b) => s + b.byteLength, 0)
  const header = new ArrayBuffer(WAV_HEADER_SIZE)
  const view = new DataView(header)
  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i))
  }
  writeStr(0, "RIFF")
  view.setUint32(4, 36 + totalPcmSize, true)
  writeStr(8, "WAVE")
  writeStr(12, "fmt ")
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, numChannels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * numChannels * (bitsPerSample / 8), true)
  view.setUint16(32, numChannels * (bitsPerSample / 8), true)
  view.setUint16(34, bitsPerSample, true)
  writeStr(36, "data")
  view.setUint32(40, totalPcmSize, true)

  return new Blob([header, ...pcmChunks], { type: "audio/wav" })
}

export function parseWavHeader(buf: ArrayBuffer): { sampleRate: number; bitsPerSample: number; numChannels: number } {
  const view = new DataView(buf)
  return {
    numChannels: view.getUint16(22, true),
    sampleRate: view.getUint32(24, true),
    bitsPerSample: view.getUint16(34, true),
  }
}

export async function mergeWavBlobs(blobs: Blob[]): Promise<Blob> {
  const buffers = await Promise.all(blobs.map((b) => b.arrayBuffer()))
  const pcmChunks: ArrayBuffer[] = []
  let sampleRate = 16000
  let bitsPerSample = 16
  let numChannels = 1

  for (let i = 0; i < buffers.length; i++) {
    const buf = buffers[i]
    if (!buf || buf.byteLength <= WAV_HEADER_SIZE) continue
    if (i === 0) {
      const h = parseWavHeader(buf)
      sampleRate = h.sampleRate
      bitsPerSample = h.bitsPerSample
      numChannels = h.numChannels
    }
    pcmChunks.push(buf.slice(WAV_HEADER_SIZE))
  }

  return buildWav(pcmChunks, sampleRate, bitsPerSample, numChannels)
}

const store = new Map<string, string>()

export async function storeLocalAudio(recordingId: string, blobs: Blob[]): Promise<void> {
  const merged = await mergeWavBlobs(blobs)
  const url = URL.createObjectURL(merged)
  const prev = store.get(recordingId)
  if (prev) URL.revokeObjectURL(prev)
  store.set(recordingId, url)
}

export function getLocalAudioUrl(recordingId: string): string | null {
  return store.get(recordingId) ?? null
}
