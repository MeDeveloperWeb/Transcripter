import { useCallback, useEffect, useRef, useState } from "react"
import { fetchChunkList, downloadChunk, type ChunkMeta } from "@/lib/api"
import { buildWav, parseWavHeader, WAV_HEADER_SIZE } from "@/lib/local-audio-store"

const INITIAL_BATCH = 10
const BACKGROUND_BATCH = 5

export function useStreamingAudio(recordingId: string) {
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadedCount, setLoadedCount] = useState(0)
  const [totalCount, setTotalCount] = useState(0)

  const audioRef = useRef<HTMLAudioElement | null>(null)
  const urlRef = useRef<string | null>(null)
  const cancelledRef = useRef(false)

  const wavParamsRef = useRef({ sampleRate: 16000, bitsPerSample: 16, numChannels: 1 })

  const rebuildAudio = useCallback((buffers: Map<number, ArrayBuffer>) => {
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

  useEffect(() => {
    cancelledRef.current = false
    const buffers = new Map<number, ArrayBuffer>()
    setLoading(true)
    setLoadedCount(0)
    setAudioUrl(null)

    const loadBatch = async (chunks: ChunkMeta[], startIdx: number, count: number) => {
      const end = Math.min(startIdx + count, chunks.length)
      let newLoaded = false

      for (let i = startIdx; i < end; i++) {
        if (cancelledRef.current) return false
        const meta = chunks[i]
        if (!meta || buffers.has(meta.sequence) || meta.status !== "acked") continue

        try {
          const buf = await downloadChunk(recordingId, meta.sequence)
          if (cancelledRef.current) return false

          if (buffers.size === 0) {
            wavParamsRef.current = parseWavHeader(buf)
          }

          buffers.set(meta.sequence, buf)
          newLoaded = true
          setLoadedCount(buffers.size)
        } catch {
          // skip, continue with next chunk
        }
      }

      if (newLoaded && !cancelledRef.current) {
        rebuildAudio(buffers)
      }
      return true
    }

    const init = async () => {
      try {
        const list = await fetchChunkList(recordingId)
        if (cancelledRef.current) return

        const ackedList = list.filter((c) => c.status === "acked")
        setTotalCount(ackedList.length)

        if (ackedList.length === 0) return

        const ok = await loadBatch(ackedList, 0, INITIAL_BATCH)
        if (!ok || cancelledRef.current) return

        setLoading(false)

        let idx = INITIAL_BATCH
        while (idx < ackedList.length && !cancelledRef.current) {
          const ok = await loadBatch(ackedList, idx, BACKGROUND_BATCH)
          if (!ok) break
          idx += BACKGROUND_BATCH
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
  }, [recordingId, rebuildAudio])

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
