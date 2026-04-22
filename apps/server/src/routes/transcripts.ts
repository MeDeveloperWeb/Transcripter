import { Hono } from "hono"
import { prisma } from "@my-better-t-app/db"
import { downloadFromStorage } from "../lib/storage"
import { transcribeAudio } from "../lib/deepgram"
import { isValidCuid } from "../lib/validation"

const transcripts = new Hono()

transcripts.post("/:recordingId/transcribe", async (c) => {
  const { recordingId } = c.req.param()

  if (!isValidCuid(recordingId)) {
    return c.json({ error: "Invalid recording ID" }, 400)
  }

  const recording = await prisma.recording.findUnique({ where: { id: recordingId } })
  if (!recording) {
    return c.json({ error: "Recording not found" }, 404)
  }

  const ackedChunks = await prisma.chunk.findMany({
    where: { recordingId, status: "acked" },
    orderBy: { sequence: "asc" },
  })

  if (ackedChunks.length === 0) {
    return c.json({ error: "No acked chunks to transcribe" }, 400)
  }

  const chunksWithPaths = ackedChunks.filter((ch) => ch.bucketPath)
  if (chunksWithPaths.length === 0) {
    return c.json({ error: "No chunks with storage paths" }, 400)
  }

  processRecordingTranscription(recordingId, chunksWithPaths).catch(() => {
    // errors stored in transcript record
  })

  return c.json({
    message: "Transcription started",
    totalChunks: chunksWithPaths.length,
  })
})

transcripts.get("/:recordingId", async (c) => {
  const { recordingId } = c.req.param()

  if (!isValidCuid(recordingId)) {
    return c.json({ error: "Invalid recording ID" }, 400)
  }

  const transcript = await prisma.transcript.findUnique({
    where: { recordingId },
    select: {
      id: true,
      text: true,
      utterances: true,
      status: true,
      error: true,
    },
  })

  return c.json({ recordingId, transcript })
})

async function processRecordingTranscription(
  recordingId: string,
  chunks: Array<{ id: string; bucketPath: string | null }>,
) {
  await prisma.transcript.upsert({
    where: { recordingId },
    create: { recordingId, status: "processing" },
    update: { status: "processing", error: null },
  })

  try {
    const WAV_HEADER_SIZE = 44
    const pcmBuffers: Uint8Array[] = []
    let sampleRate = 16000
    let bitsPerSample = 16
    let numChannels = 1

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i]
      if (!chunk?.bucketPath) continue
      const data = await downloadFromStorage(chunk.bucketPath)
      if (data.byteLength <= WAV_HEADER_SIZE) continue
      if (i === 0) {
        const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
        numChannels = view.getUint16(22, true)
        sampleRate = view.getUint32(24, true)
        bitsPerSample = view.getUint16(34, true)
      }
      pcmBuffers.push(data.slice(WAV_HEADER_SIZE))
    }

    const totalPcmSize = pcmBuffers.reduce((sum, buf) => sum + buf.byteLength, 0)
    const header = new Uint8Array(WAV_HEADER_SIZE)
    const hView = new DataView(header.buffer)
    const writeStr = (offset: number, str: string) => {
      for (let j = 0; j < str.length; j++) header[offset + j] = str.charCodeAt(j)
    }
    writeStr(0, "RIFF")
    hView.setUint32(4, 36 + totalPcmSize, true)
    writeStr(8, "WAVE")
    writeStr(12, "fmt ")
    hView.setUint32(16, 16, true)
    hView.setUint16(20, 1, true)
    hView.setUint16(22, numChannels, true)
    hView.setUint32(24, sampleRate, true)
    hView.setUint32(28, sampleRate * numChannels * (bitsPerSample / 8), true)
    hView.setUint16(32, numChannels * (bitsPerSample / 8), true)
    hView.setUint16(34, bitsPerSample, true)
    writeStr(36, "data")
    hView.setUint32(40, totalPcmSize, true)

    const merged = new Uint8Array(WAV_HEADER_SIZE + totalPcmSize)
    merged.set(header, 0)
    let offset = WAV_HEADER_SIZE
    for (const pcm of pcmBuffers) {
      merged.set(pcm, offset)
      offset += pcm.byteLength
    }

    const result = await transcribeAudio(merged)

    const fullText = result.results?.channels[0]?.alternatives[0]?.transcript ?? ""
    const utterances = (result.results?.utterances ?? []).map((u) => ({
      speaker: u.speaker,
      text: u.transcript,
      start: u.start,
      end: u.end,
      confidence: u.confidence,
    }))

    await prisma.transcript.update({
      where: { recordingId },
      data: { text: fullText, utterances, status: "completed" },
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown transcription error"
    await prisma.transcript.update({
      where: { recordingId },
      data: { status: "failed", error: message },
    })
  }
}

export { transcripts }
