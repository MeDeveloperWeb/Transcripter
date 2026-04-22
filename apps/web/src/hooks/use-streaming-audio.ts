import { useCallback, useEffect, useRef, useState } from "react"
import { fetchChunkList, downloadChunk, type ChunkMeta } from "@/lib/api"
import { buildWav, parseWavHeader, WAV_HEADER_SIZE } from "@/lib/local-audio-store"

const BUFFER_AHEAD = 10
const REFETCH_THRESHOLD = 2

export function useStreamingAudio(recordingId: string) {
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadedCount, setLoadedCount] = useState(0)
  const [totalCount, setTotalCount] = useState(0)

  const audioRef = useRef<HTMLAudioElement | null>(null)
  const urlRef = useRef<string | null>(null)
  const chunkListRef = useRef<ChunkMeta[]>([])
  const loadedBuffersRef = useRef<Map<number, ArrayBuffer>>(new Map())
  const loadingRef = useRef(false)
  const cancelledRef = useRef(false)

  const wavParamsRef = useRef({ sampleRate: 16000, bitsPerSample: 16, numChannels: 1 })

  const rebuildAudio = useCallback(() => {
    const buffers = loadedBuffersRef.current
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

  const loadChunks = useCallback(async (startIdx: number, count: number) => {
    if (loadingRef.current || cancelledRef.current) return
    loadingRef.current = true

    const chunks = chunkListRef.current
    const end = Math.min(startIdx + count, chunks.length)
    let newLoaded = false

    for (let i = startIdx; i < end; i++) {
      if (cancelledRef.current) break
      const meta = chunks[i]
      if (!meta || loadedBuffersRef.current.has(meta.sequence)) continue
      if (meta.status !== "acked") continue

      try {
        const buf = await downloadChunk(recordingId, meta.sequence)
        if (cancelledRef.current) break

        if (loadedBuffersRef.current.size === 0) {
          wavParamsRef.current = parseWavHeader(buf)
        }

        loadedBuffersRef.current.set(meta.sequence, buf)
        newLoaded = true
        setLoadedCount(loadedBuffersRef.current.size)
      } catch {
        // skip failed chunk, will retry on next load cycle
      }
    }

    if (newLoaded && !cancelledRef.current) {
      rebuildAudio()
    }

    loadingRef.current = false
  }, [recordingId, rebuildAudio])

  const checkAndLoadMore = useCallback(() => {
    const el = audioRef.current
    if (!el || loadingRef.current) return

    const chunks = chunkListRef.current
    if (chunks.length === 0) return

    const chunkDuration = chunks[0]?.duration ?? 5
    const currentChunkIdx = Math.floor(el.currentTime / chunkDuration)
    const loadedCount = loadedBuffersRef.current.size
    const chunksAheadOfPlayback = loadedCount - currentChunkIdx

    if (chunksAheadOfPlayback <= REFETCH_THRESHOLD && loadedCount < chunks.length) {
      loadChunks(loadedCount, BUFFER_AHEAD)
    }
  }, [loadChunks])

  useEffect(() => {
    cancelledRef.current = false
    loadedBuffersRef.current = new Map()
    setLoading(true)
    setLoadedCount(0)

    const init = async () => {
      try {
        const list = await fetchChunkList(recordingId)
        if (cancelledRef.current) return

        const ackedList = list.filter((c) => c.status === "acked")
        chunkListRef.current = ackedList
        setTotalCount(ackedList.length)

        if (ackedList.length > 0) {
          await loadChunks(0, BUFFER_AHEAD)
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
  }, [recordingId, loadChunks])

  useEffect(() => {
    const interval = setInterval(checkAndLoadMore, 1000)
    return () => clearInterval(interval)
  }, [checkAndLoadMore])

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
