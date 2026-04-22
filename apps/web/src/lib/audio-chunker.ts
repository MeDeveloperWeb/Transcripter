const CHUNK_DURATION = 5
const TARGET_SAMPLE_RATE = 16000

function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buffer)

  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i))
    }
  }

  writeStr(0, "RIFF")
  view.setUint32(4, 36 + samples.length * 2, true)
  writeStr(8, "WAVE")
  writeStr(12, "fmt ")
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeStr(36, "data")
  view.setUint32(40, samples.length * 2, true)

  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }

  return new Blob([buffer], { type: "audio/wav" })
}

function resample(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return input
  const ratio = fromRate / toRate
  const length = Math.round(input.length / ratio)
  const output = new Float32Array(length)
  for (let i = 0; i < length; i++) {
    const srcIndex = i * ratio
    const low = Math.floor(srcIndex)
    const high = Math.min(low + 1, input.length - 1)
    const frac = srcIndex - low
    output[i] = input[low] * (1 - frac) + input[high] * frac
  }
  return output
}

function mixToMono(audioBuffer: AudioBuffer): Float32Array {
  if (audioBuffer.numberOfChannels === 1) {
    return audioBuffer.getChannelData(0)
  }
  const length = audioBuffer.length
  const mono = new Float32Array(length)
  const channels = audioBuffer.numberOfChannels
  for (let ch = 0; ch < channels; ch++) {
    const data = audioBuffer.getChannelData(ch)
    for (let i = 0; i < length; i++) {
      mono[i] += data[i] / channels
    }
  }
  return mono
}

export interface AudioChunk {
  sequence: number
  blob: Blob
  duration: number
}

export async function chunkifyAudioFile(file: File): Promise<AudioChunk[]> {
  const arrayBuffer = await file.arrayBuffer()
  const audioCtx = new AudioContext()
  const decoded = await audioCtx.decodeAudioData(arrayBuffer)
  await audioCtx.close()

  const mono = mixToMono(decoded)
  const resampled = resample(mono, decoded.sampleRate, TARGET_SAMPLE_RATE)

  const samplesPerChunk = TARGET_SAMPLE_RATE * CHUNK_DURATION
  const chunks: AudioChunk[] = []

  for (let i = 0; i < resampled.length; i += samplesPerChunk) {
    const end = Math.min(i + samplesPerChunk, resampled.length)
    const segment = resampled.slice(i, end)
    const duration = segment.length / TARGET_SAMPLE_RATE

    chunks.push({
      sequence: chunks.length,
      blob: encodeWav(segment, TARGET_SAMPLE_RATE),
      duration,
    })
  }

  return chunks
}
