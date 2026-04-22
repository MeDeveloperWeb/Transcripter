import { Hono } from "hono"
import { z } from "zod"
import { prisma } from "@my-better-t-app/db"
import { existsInStorage } from "../lib/storage"
import { isValidCuid } from "../lib/validation"

const reconcile = new Hono()

const bodySchema = z.object({
  clientSequences: z.array(z.number().int().nonnegative()),
})

reconcile.post("/:recordingId", async (c) => {
  const { recordingId } = c.req.param()

  if (!isValidCuid(recordingId)) {
    return c.json({ error: "Invalid recording ID" }, 400)
  }

  const parsed = bodySchema.safeParse(await c.req.json())
  if (!parsed.success) {
    return c.json({ error: "Invalid request body" }, 400)
  }
  const clientSequences = new Set(parsed.data.clientSequences)

  const recording = await prisma.recording.findUnique({ where: { id: recordingId } })
  if (!recording) {
    return c.json({ error: "Recording not found" }, 404)
  }

  const serverChunks = await prisma.chunk.findMany({
    where: { recordingId },
    orderBy: { sequence: "asc" },
  })

  const ackedSequences = new Set(
    serverChunks.filter((ch) => ch.status === "acked").map((ch) => ch.sequence),
  )

  const needsUpload: number[] = []
  for (const seq of clientSequences) {
    if (!ackedSequences.has(seq)) {
      needsUpload.push(seq)
    }
  }

  const ackedChunks = serverChunks.filter((ch) => ch.status === "acked" && ch.bucketPath)
  const existenceResults = await Promise.allSettled(
    ackedChunks.map(async (chunk) => ({
      chunk,
      exists: await existsInStorage(chunk.bucketPath!),
    })),
  )

  const bucketMissing: number[] = []
  for (const result of existenceResults) {
    if (result.status === "fulfilled" && !result.value.exists) {
      bucketMissing.push(result.value.chunk.sequence)
      await prisma.chunk.update({
        where: { id: result.value.chunk.id },
        data: { status: "pending" },
      })
    }
    // rejected results (transient errors) are skipped — chunk status unchanged
  }

  const allMissing = [...new Set([...needsUpload, ...bucketMissing])].sort((a, b) => a - b)

  return c.json({
    recordingId,
    missing: allMissing,
    needsUpload: needsUpload.length,
    bucketRepair: bucketMissing.length,
    total: serverChunks.length,
    healthy: ackedSequences.size - bucketMissing.length,
  })
})

export { reconcile }
