import { useCallback, useEffect, useRef, useState } from "react"
import {
  saveChunkToOPFS,
  getChunkFromOPFS,
  deleteChunkFromOPFS,
  deleteRecordingFromOPFS,
  listChunksInOPFS,
} from "@/lib/opfs"
import {
  createRecording,
  uploadChunk,
  completeRecording,
  reconcileRecording,
} from "@/lib/api"
import type { WavChunk } from "./use-recorder"

export type ChunkUploadStatus = "saving" | "saved" | "uploading" | "acked" | "failed"

export interface TrackedChunk {
  id: string
  sequence: number
  duration: number
  uploadStatus: ChunkUploadStatus
  retryCount: number
}

const MAX_RETRIES = 3
const RETRY_DELAY_MS = 2000

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function useUploadPipeline() {
  const [recordingId, setRecordingId] = useState<string | null>(null)
  const [trackedChunks, setTrackedChunks] = useState<TrackedChunk[]>([])
  const [isReconciling, setIsReconciling] = useState(false)
  const [pipelineError, setPipelineError] = useState<string | null>(null)
  const sequenceRef = useRef(0)
  const recordingIdRef = useRef<string | null>(null)
  const trackedChunksRef = useRef<TrackedChunk[]>([])
  const pendingUploadsRef = useRef<Promise<void>[]>([])
  const sessionAbortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    trackedChunksRef.current = trackedChunks
  }, [trackedChunks])

  const updateChunkStatus = useCallback(
    (sequence: number, updates: Partial<TrackedChunk>) => {
      setTrackedChunks((prev) =>
        prev.map((t) => (t.sequence === sequence ? { ...t, ...updates } : t)),
      )
    },
    [],
  )

  const attemptUpload = useCallback(
    async (recId: string, sequence: number, blob: Blob, duration: number, retry = 0) => {
      if (sessionAbortRef.current?.signal.aborted) return

      updateChunkStatus(sequence, { uploadStatus: "uploading", retryCount: retry })

      const uploadBlob =
        retry > 0 ? ((await getChunkFromOPFS(recId, sequence)) ?? blob) : blob

      try {
        await uploadChunk(recId, sequence, uploadBlob, duration)
        if (sessionAbortRef.current?.signal.aborted) return
        updateChunkStatus(sequence, { uploadStatus: "acked" })
        await deleteChunkFromOPFS(recId, sequence)
      } catch {
        if (sessionAbortRef.current?.signal.aborted) return
        if (retry < MAX_RETRIES) {
          await wait(RETRY_DELAY_MS * (retry + 1))
          await attemptUpload(recId, sequence, blob, duration, retry + 1)
        } else {
          updateChunkStatus(sequence, { uploadStatus: "failed", retryCount: retry })
        }
      }
    },
    [updateChunkStatus],
  )

  const startSession = useCallback(async () => {
    sessionAbortRef.current?.abort()
    sessionAbortRef.current = new AbortController()
    pendingUploadsRef.current = []

    try {
      const { id } = await createRecording()
      setRecordingId(id)
      recordingIdRef.current = id
      sequenceRef.current = 0
      setTrackedChunks([])
      setPipelineError(null)
      return id
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to start session"
      setPipelineError(message)
      throw err
    }
  }, [])

  const processChunk = useCallback(
    (chunk: WavChunk) => {
      const recId = recordingIdRef.current
      if (!recId) return

      const sequence = sequenceRef.current
      sequenceRef.current += 1

      const tracked: TrackedChunk = {
        id: chunk.id,
        sequence,
        duration: chunk.duration,
        uploadStatus: "saving",
        retryCount: 0,
      }
      setTrackedChunks((prev) => [...prev, tracked])

      const fullPromise = (async () => {
        try {
          await saveChunkToOPFS(recId, sequence, chunk.blob)
          updateChunkStatus(sequence, { uploadStatus: "saved" })
        } catch {
          updateChunkStatus(sequence, { uploadStatus: "failed" })
          return
        }

        await attemptUpload(recId, sequence, chunk.blob, chunk.duration)
      })()

      pendingUploadsRef.current.push(fullPromise)
      fullPromise.finally(() => {
        pendingUploadsRef.current = pendingUploadsRef.current.filter((p) => p !== fullPromise)
      })
    },
    [attemptUpload, updateChunkStatus],
  )

  const endSession = useCallback(async () => {
    const recId = recordingIdRef.current
    if (!recId) return
    try {
      await Promise.allSettled(pendingUploadsRef.current)

      await completeRecording(recId)
      const chunks = trackedChunksRef.current
      const allAcked = chunks.length > 0 && chunks.every((t) => t.uploadStatus === "acked")
      if (allAcked) {
        await deleteRecordingFromOPFS(recId)
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to complete recording"
      setPipelineError(message)
    }
  }, [])

  const reconcile = useCallback(async () => {
    const recId = recordingIdRef.current
    if (!recId) return

    setIsReconciling(true)
    try {
      const opfsSequences = await listChunksInOPFS(recId)
      const { missing } = await reconcileRecording(recId, opfsSequences)

      for (const sequence of missing) {
        const blob = await getChunkFromOPFS(recId, sequence)
        if (blob) {
          const tracked = trackedChunksRef.current.find((t) => t.sequence === sequence)
          const duration = tracked?.duration ?? 5
          await attemptUpload(recId, sequence, blob, duration)
        }
      }
    } finally {
      setIsReconciling(false)
    }
  }, [attemptUpload])

  const cleanup = useCallback(async () => {
    const recId = recordingIdRef.current
    if (!recId) return
    const allAcked = trackedChunksRef.current.every((t) => t.uploadStatus === "acked")
    if (allAcked) {
      await deleteRecordingFromOPFS(recId)
    }
  }, [])

  return {
    recordingId,
    trackedChunks,
    isReconciling,
    pipelineError,
    startSession,
    processChunk,
    endSession,
    reconcile,
    cleanup,
  }
}
