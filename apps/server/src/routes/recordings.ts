import { Hono } from "hono"
import { prisma } from "@my-better-t-app/db"
import { isValidCuid } from "../lib/validation"

const recordings = new Hono()

recordings.post("/", async (c) => {
  const recording = await prisma.recording.create({
    data: {},
  })
  return c.json({ id: recording.id }, 201)
})

recordings.get("/", async (c) => {
  const list = await prisma.recording.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      status: true,
      duration: true,
      createdAt: true,
      _count: { select: { chunks: true } },
    },
    take: 50,
  })
  return c.json(list)
})

recordings.get("/:id", async (c) => {
  const { id } = c.req.param()

  if (!isValidCuid(id)) {
    return c.json({ error: "Invalid recording ID" }, 400)
  }

  const recording = await prisma.recording.findUnique({
    where: { id },
    include: {
      chunks: {
        orderBy: { sequence: "asc" },
        include: { transcript: true },
      },
    },
  })
  if (!recording) {
    return c.json({ error: "Recording not found" }, 404)
  }
  return c.json(recording)
})

recordings.post("/:id/complete", async (c) => {
  const { id } = c.req.param()

  if (!isValidCuid(id)) {
    return c.json({ error: "Invalid recording ID" }, 400)
  }

  const recording = await prisma.recording.findUnique({
    where: { id },
    include: { chunks: true },
  })
  if (!recording) {
    return c.json({ error: "Recording not found" }, 404)
  }

  if (recording.status !== "recording") {
    return c.json({ error: `Cannot complete recording with status: ${recording.status}` }, 409)
  }

  const totalDuration = recording.chunks.reduce((sum, ch) => sum + ch.duration, 0)

  const updated = await prisma.recording.update({
    where: { id },
    data: { status: "completed", duration: totalDuration },
  })
  return c.json(updated)
})

export { recordings }
