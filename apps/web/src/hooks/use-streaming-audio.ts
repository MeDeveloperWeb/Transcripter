import { useCallback, useEffect, useRef, useState } from "react"
import { fetchChunkList, downloadChunk, type ChunkMeta } from "@/lib/api"
import { buildWav, parseWavHeader, WAV_HEADER_SIZE } from "@/lib/local-audio-store"

const INITIAL_BATCH = 10
const LOAD_BATCH = 5
const REFETCH_WHEN_REMAINING = 2
const POLL_INTERVAL_MS = 500

export function useStreamingAudio(recordingId: string) {
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadedCount, setLoadedCount] = useState(0)
  const [totalCount, setTotalCount] = useState(0)

  const audioRef = useRef<HTMLAudioElement | null>(null)
  const urlRef = useRef<string | null>(null)
  const cancelledRef = useRef(false)
  const loadingRef = useRef(false)
  const buffersRef = useRef<Map<number, ArrayBuffer>>(new Map())
  const chunkListRef = useRef<ChunkMeta[]>([])
  const wavParamsRef = useRef({ sampleRate: 16000, bitsPerSample: 16, numChannels: 1 })

  const rebuildAudio = useCallback(() => {
    const buffers = buffersRef.current
    if (buffers.size === 0) return

    const sortedKeys = [...buffers.keys()].sort((a, b) => a - b)
    const pcmChunks: ArrayBuffer[] = []

    for (const seq of sortedKeys) {
      const buf = buffers.get(seq)!
      if (buf.byteLength <= WAV_HEADER_SIZE) continue
      pcmChunks.push(buf.slice(WAV_HEADER_SIZE))
    }

    const { sampleRate, bitsPerSample, numChannels } = wavParamsRef.current
    const merged = buildWav(pcmChunks, sampleRate, bitsPerSample, numChannels)

    const el = audioRef.current
    const currentTime = el ? el.currentTime : 0

    const newUrl = URL.createObjectURL(merged)
    if (urlRef.current) URL.revokeObjectURL(urlRef.current)
    urlRef.current = newUrl
    setAudioUrl(newUrl)

    if (el && currentTime > 0) {
      requestAnimationFrame(() => {
        el.currentTime = currentTime
      })
    }
  }, [])

  const loadBatch = useCallback(async (startIdx: number, count: number): Promise<boolean> => {
    if (loadingRef.current || cancelledRef.current) return false
    loadingRef.current = true

    const chunks = chunkListRef.current
    const end = Math.min(startIdx + count, chunks.length)
    let newLoaded = false

    for (let i = startIdx; i < end; i++) {
      if (cancelledRef.current) break
      const meta = chunks[i]
      if (!meta || buffersRef.current.has(meta.sequence) || meta.status !== "acked") continue

      try {
        const buf = await downloadChunk(recordingId, meta.sequence)
        if (cancelledRef.current) break

        if (buffersRef.current.size === 0) {
          wavParamsRef.current = parseWavHeader(buf)
        }

        buffersRef.current.set(meta.sequence, buf)
        newLoaded = true
        setLoadedCount(buffersRef.current.size)
      } catch {
        // skip failed chunk
      }
    }

    if (newLoaded && !cancelledRef.current) {
      rebuildAudio()
    }

    loadingRef.current = false
    return newLoaded
  }, [recordingId, rebuildAudio])

  useEffect(() => {
    cancelledRef.current = false
    buffersRef.current = new Map()
    loadingRef.current = false
    setLoading(true)
    setLoadedCount(0)
    setAudioUrl(null)

    const init = async () => {
      try {
        const list = await fetchChunkList(recordingId)
        if (cancelledRef.current) return

        const ackedList = list.filter((c) => c.status === "acked")
        chunkListRef.current = ackedList
        setTotalCount(ackedList.length)

        if (ackedList.length > 0) {
          await loadBatch(0, INITIAL_BATCH)
        }
      } finally {
        if (!cancelledRef.current) setLoading(false)
      }
    }

    init()

    return () => {
      cancelledRef.current = true
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current)
        urlRef.current = null
      }
    }
  }, [recordingId, loadBatch])

  useEffect(() => {
    const interval = setInterval(() => {
      if (loadingRef.current || cancelledRef.current) return

      const chunks = chunkListRef.current
      const loaded = buffersRef.current.size
      if (loaded >= chunks.length) return

      const el = audioRef.current
      if (!el) return

      const chunkDuration = chunks[0]?.duration ?? 5
      const currentChunkIdx = Math.floor(el.currentTime / chunkDuration)
      const chunksAhead = loaded - currentChunkIdx

      if (chunksAhead <= REFETCH_WHEN_REMAINING) {
        loadBatch(loaded, LOAD_BATCH)
      }
    }, POLL_INTERVAL_MS)

    return () => clearInterval(interval)
  }, [loadBatch])

  const setAudioElement = useCallback((el: HTMLAudioElement | null) => {
    audioRef.current = el
  }, [])

  return {
    audioUrl,
    loading,
    loadedCount,
    totalCount,
    setAudioElement,
  }
}
