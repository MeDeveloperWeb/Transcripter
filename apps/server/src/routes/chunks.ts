import { Hono } from "hono"
import { bodyLimit } from "hono/body-limit"
import { prisma } from "@my-better-t-app/db"
import { uploadToStorage } from "../lib/storage"

const chunks = new Hono()

chunks.use(bodyLimit({ maxSize: 10 * 1024 * 1024 }))

chunks.post("/:recordingId", async (c) => {
  const { recordingId } = c.req.param()

  const recording = await prisma.recording.findUnique({
    where: { id: recordingId },
  })
  if (!recording) {
    return c.json({ error: "Recording not found" }, 404)
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

  const bucketPath = `${recordingId}/chunk-${String(sequence).padStart(5, "0")}.wav`
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
    update: {},
  })

  try {
    await uploadToStorage(bucketPath, buffer, "audio/wav")
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

export { chunks }
