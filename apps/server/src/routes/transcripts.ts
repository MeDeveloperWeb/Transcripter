import { Hono } from "hono"
import { prisma } from "@my-better-t-app/db"
import { downloadFromStorage } from "../lib/storage"
import { transcribeAudio } from "../lib/deepgram"

const transcripts = new Hono()

transcripts.post("/:recordingId/transcribe", async (c) => {
  const { recordingId } = c.req.param()

  const ackedChunks = await prisma.chunk.findMany({
    where: { recordingId, status: "acked" },
    include: { transcript: true },
    orderBy: { sequence: "asc" },
  })

  if (ackedChunks.length === 0) {
    return c.json({ error: "No acked chunks to transcribe" }, 400)
  }

  const toTranscribe = ackedChunks.filter(
    (ch) => !ch.transcript || ch.transcript.status !== "completed",
  )

  transcribeInBatches(
    toTranscribe.map((ch) => ({ id: ch.id, bucketPath: ch.bucketPath! })),
  ).catch(() => {
    // errors stored per-transcript record
  })

  return c.json({
    message: "Transcription started",
    processing: toTranscribe.length,
    alreadyDone: ackedChunks.length - toTranscribe.length,
  })
})

transcripts.get("/:recordingId", async (c) => {
  const { recordingId } = c.req.param()

  const [chunkList, transcriptList] = await Promise.all([
    prisma.chunk.findMany({
      where: { recordingId },
      orderBy: { sequence: "asc" },
      select: { id: true, sequence: true, duration: true },
    }),
    prisma.transcript.findMany({
      where: { recordingId },
      select: {
        chunkId: true,
        text: true,
        utterances: true,
        status: true,
        error: true,
      },
    }),
  ])

  const transcriptMap = new Map(transcriptList.map((t) => [t.chunkId, t]))

  const result = chunkList.map((ch) => {
    const t = transcriptMap.get(ch.id)
    return {
      sequence: ch.sequence,
      chunkId: ch.id,
      duration: ch.duration,
      transcript: t
        ? { text: t.text, utterances: t.utterances, status: t.status, error: t.error }
        : null,
    }
  })

  return c.json({ recordingId, chunks: result })
})

const TRANSCRIPTION_CONCURRENCY = 5

async function transcribeInBatches(chunks: Array<{ id: string; bucketPath: string }>) {
  for (let i = 0; i < chunks.length; i += TRANSCRIPTION_CONCURRENCY) {
    const batch = chunks.slice(i, i + TRANSCRIPTION_CONCURRENCY)
    await Promise.allSettled(
      batch.map((ch) => processTranscription(ch.id, ch.bucketPath)),
    )
  }
}

async function processTranscription(chunkId: string, bucketPath: string) {
  const chunk = await prisma.chunk.findUniqueOrThrow({ where: { id: chunkId } })

  await prisma.transcript.upsert({
    where: { chunkId },
    create: { chunkId, recordingId: chunk.recordingId, status: "processing" },
    update: { status: "processing", error: null },
  })

  try {
    const buffer = await downloadFromStorage(bucketPath)
    const result = await transcribeAudio(buffer)

    const transcript = result.results?.channels[0]?.alternatives[0]?.transcript ?? ""
    const utterances = (result.results?.utterances ?? []).map((u) => ({
      speaker: u.speaker,
      text: u.transcript,
      start: u.start,
      end: u.end,
      confidence: u.confidence,
    }))

    await prisma.transcript.update({
      where: { chunkId },
      data: {
        text: transcript,
        utterances,
        status: "completed",
      },
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown transcription error"
    await prisma.transcript.update({
      where: { chunkId },
      data: { status: "failed", error: message },
    })
  }
}

export { transcripts }
