import { Hono } from "hono"
import { bodyLimit } from "hono/body-limit"
import { prisma } from "@my-better-t-app/db"
import { uploadToStorage, downloadFromStorage } from "../lib/storage"
import { isValidCuid } from "../lib/validation"

const chunks = new Hono()

const UPLOAD_LIMIT = 100 * 1024 * 1024

chunks.post("/:recordingId", bodyLimit({ maxSize: UPLOAD_LIMIT }), async (c) => {
  const { recordingId } = c.req.param()

  if (!isValidCuid(recordingId)) {
    return c.json({ error: "Invalid recording ID" }, 400)
  }

  const recording = await prisma.recording.findUnique({
    where: { id: recordingId },
  })
  if (!recording) {
    return c.json({ error: "Recording not found" }, 404)
  }

  if (recording.status !== "recording") {
    return c.json({ error: `Cannot upload chunks to recording with status: ${recording.status}` }, 409)
  }

  const formData = await c.req.formData()
  const file = formData.get("audio") as File | null
  const sequenceStr = formData.get("sequence") as string | null
  const durationStr = formData.get("duration") as string | null

  if (!file || !sequenceStr || !durationStr) {
    return c.json({ error: "Missing required fields: audio, sequence, duration" }, 400)
  }

  const sequence = Number(sequenceStr)
  const duration = Number(durationStr)

  if (Number.isNaN(sequence) || Number.isNaN(duration)) {
    return c.json({ error: "sequence and duration must be numbers" }, 400)
  }

  const ext = file.name.split(".").pop() ?? "wav"
  const bucketPath = `${recordingId}/chunk-${String(sequence).padStart(5, "0")}.${ext}`
  const contentType = file.type || "audio/wav"
  const buffer = await file.arrayBuffer()

  const chunk = await prisma.chunk.upsert({
    where: {
      recordingId_sequence: { recordingId, sequence },
    },
    create: {
      recordingId,
      sequence,
      duration,
      size: buffer.byteLength,
      status: "pending",
    },
    update: {
      duration,
      size: buffer.byteLength,
      status: "pending",
    },
  })

  try {
    await uploadToStorage(bucketPath, buffer, contentType)
  } catch {
    await prisma.chunk.update({
      where: { id: chunk.id },
      data: { status: "failed" },
    })
    return c.json({ error: "Storage upload failed" }, 500)
  }

  const updated = await prisma.chunk.update({
    where: { id: chunk.id },
    data: { bucketPath, status: "acked" },
  })

  return c.json({ chunkId: updated.id, status: updated.status }, 201)
})

chunks.get("/:recordingId", async (c) => {
  const { recordingId } = c.req.param()

  if (!isValidCuid(recordingId)) {
    return c.json({ error: "Invalid recording ID" }, 400)
  }

  const chunkList = await prisma.chunk.findMany({
    where: { recordingId },
    orderBy: { sequence: "asc" },
    select: {
      id: true,
      sequence: true,
      status: true,
      duration: true,
      size: true,
      createdAt: true,
    },
  })
  return c.json(chunkList)
})

chunks.get("/:recordingId/:sequence/download", async (c) => {
  const { recordingId, sequence: seqStr } = c.req.param()

  if (!isValidCuid(recordingId)) {
    return c.json({ error: "Invalid recording ID" }, 400)
  }

  const sequence = Number(seqStr)
  if (Number.isNaN(sequence)) {
    return c.json({ error: "Invalid sequence number" }, 400)
  }

  const chunk = await prisma.chunk.findUnique({
    where: { recordingId_sequence: { recordingId, sequence } },
  })

  if (!chunk || !chunk.bucketPath || chunk.status !== "acked") {
    return c.json({ error: "Chunk not found" }, 404)
  }

  const data = await downloadFromStorage(chunk.bucketPath)

  return new Response(data, {
    headers: {
      "Content-Type": "audio/wav",
      "Content-Length": String(data.byteLength),
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  })
})

export { chunks }
