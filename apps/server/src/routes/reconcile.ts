import { Hono } from "hono"
import { prisma } from "@my-better-t-app/db"
import { existsInStorage } from "../lib/storage"

const reconcile = new Hono()

reconcile.post("/:recordingId", async (c) => {
  const { recordingId } = c.req.param()

  const body = await c.req.json<{ clientSequences: number[] }>()
  const clientSequences = new Set(body.clientSequences ?? [])

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

  const bucketMissing: number[] = []
  for (const chunk of serverChunks) {
    if (chunk.status !== "acked" || !chunk.bucketPath) continue

    const exists = await existsInStorage(chunk.bucketPath)

    if (!exists) {
      bucketMissing.push(chunk.sequence)
      await prisma.chunk.update({
        where: { id: chunk.id },
        data: { status: "pending" },
      })
    }
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
