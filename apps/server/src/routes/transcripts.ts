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
    // errors stored in transcript records
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

  const transcriptList = await prisma.transcript.findMany({
    where: { recordingId },
    orderBy: { createdAt: "desc" },
    take: 1,
    select: {
      id: true,
      text: true,
      utterances: true,
      status: true,
      error: true,
    },
  })

  const transcript = transcriptList[0] ?? null

  return c.json({ recordingId, transcript })
})

async function processRecordingTranscription(
  recordingId: string,
  chunks: Array<{ id: string; bucketPath: string | null }>,
) {
  const firstChunk = chunks[0]
  if (!firstChunk) return
  const firstChunkId = firstChunk.id

  await prisma.transcript.upsert({
    where: { chunkId: firstChunkId },
    create: { chunkId: firstChunkId, recordingId, status: "processing" },
    update: { status: "processing", error: null },
  })

  try {
    const audioBuffers: Uint8Array[] = []
    for (const chunk of chunks) {
      if (!chunk.bucketPath) continue
      const data = await downloadFromStorage(chunk.bucketPath)
      audioBuffers.push(data)
    }

    const totalSize = audioBuffers.reduce((sum, buf) => sum + buf.length, 0)
    const merged = new Uint8Array(totalSize)
    let offset = 0
    for (const buf of audioBuffers) {
      merged.set(buf, offset)
      offset += buf.length
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
      where: { chunkId: firstChunkId },
      data: {
        text: fullText,
        utterances,
        status: "completed",
      },
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown transcription error"
    await prisma.transcript.update({
      where: { chunkId: firstChunkId },
      data: { status: "failed", error: message },
    })
  }
}

export { transcripts }
