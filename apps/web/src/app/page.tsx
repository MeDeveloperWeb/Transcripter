"use client"

import { useCallback, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import {
  Mic,
  Pause,
  Play,
  Square,
  FileUp,
  Loader2,
} from "lucide-react"

import { Button } from "@my-better-t-app/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@my-better-t-app/ui/components/card"
import { LiveWaveform } from "@/components/ui/live-waveform"
import { useRecorder } from "@/hooks/use-recorder"
import { useUploadPipeline } from "@/hooks/use-upload-pipeline"
import {
  createRecording,
  uploadChunk,
  completeRecording,
} from "@/lib/api"
import { storeLocalAudio } from "@/lib/local-audio-store"
import { chunkifyAudioFile } from "@/lib/audio-chunker"

function formatTime(seconds: number) {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  const ms = Math.floor((seconds % 1) * 10)
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${ms}`
}

export default function HomePage() {
  const router = useRouter()
  const pipeline = useUploadPipeline()
  const [saving, setSaving] = useState(false)

  const onChunk = useCallback(
    (chunk: Parameters<typeof pipeline.processChunk>[0]) => {
      pipeline.processChunk(chunk)
    },
    [pipeline.processChunk],
  )

  const { status, start, stop, pause, resume, chunksRef, elapsed, stream } =
    useRecorder({ chunkDuration: 5, onChunk })

  const isRecording = status === "recording"
  const isPaused = status === "paused"
  const isActive = isRecording || isPaused

  const handleRecord = useCallback(async () => {
    if (isActive) {
      setSaving(true)
      stop()
      await pipeline.endSession()
      const recId = pipeline.recordingId
      const allChunks = chunksRef.current
      if (recId && allChunks.length > 0) {
        await storeLocalAudio(recId, allChunks.map((c) => c.blob))
      }
      setSaving(false)
      if (recId) {
        router.push(`/recordings/${recId}`)
      }
    } else {
      try {
        await pipeline.startSession()
        await start()
      } catch {
        // mic denied or session failed
      }
    }
  }, [isActive, stop, start, pipeline.endSession, pipeline.startSession, pipeline.recordingId, chunksRef, router])

  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)

  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const chunks = await chunkifyAudioFile(file)
      const { id } = await createRecording()
      const BATCH_SIZE = 5
      for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
        const batch = chunks.slice(i, i + BATCH_SIZE)
        await Promise.all(batch.map((c) => uploadChunk(id, c.sequence, c.blob, c.duration)))
      }
      await completeRecording(id)
      await storeLocalAudio(id, chunks.map((c) => c.blob))
      router.push(`/recordings/${id}`)
    } catch (err) {
      alert(err instanceof Error ? err.message : "Upload failed")
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ""
    }
  }, [router])

  const ackedCount = pipeline.trackedChunks.filter((t) => t.uploadStatus === "acked").length
  const failedCount = pipeline.trackedChunks.filter((t) => t.uploadStatus === "failed").length

  return (
    <div className="flex flex-1 items-center justify-center px-4 py-8">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle>New Recording</CardTitle>
          <CardDescription>16 kHz / 16-bit PCM WAV — chunked every 5 s</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <div className="overflow-hidden rounded-sm border border-border/50 bg-muted/20 text-foreground">
            <LiveWaveform
              active={isRecording}
              processing={isPaused}
              stream={stream}
              height={80}
              barWidth={3}
              barGap={1}
              barRadius={2}
              sensitivity={1.8}
              smoothingTimeConstant={0.85}
              fadeEdges
              fadeWidth={32}
              mode="static"
            />
          </div>

          <div className="text-center font-mono text-3xl tabular-nums tracking-tight">
            {formatTime(elapsed)}
          </div>

          {isActive && (
            <div className="flex items-center justify-center gap-4 text-xs text-muted-foreground">
              <span className="text-green-500">{ackedCount} synced</span>
              {failedCount > 0 && <span className="text-red-500">{failedCount} failed</span>}
              {pipeline.pipelineError && (
                <span className="text-red-500">{pipeline.pipelineError}</span>
              )}
            </div>
          )}

          {saving && (
            <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Saving recording...
            </div>
          )}

          <div className="flex items-center justify-center gap-3">
            <Button
              size="lg"
              variant={isActive ? "destructive" : "default"}
              className="gap-2 px-5"
              onClick={handleRecord}
              disabled={status === "requesting" || uploading || saving}
            >
              {isActive ? (
                <>
                  <Square className="size-4" />
                  Stop
                </>
              ) : (
                <>
                  <Mic className="size-4" />
                  {status === "requesting" ? "Requesting..." : "Record"}
                </>
              )}
            </Button>

            {isActive && (
              <Button
                size="lg"
                variant="outline"
                className="gap-2"
                onClick={isPaused ? resume : pause}
              >
                {isPaused ? (
                  <>
                    <Play className="size-4" />
                    Resume
                  </>
                ) : (
                  <>
                    <Pause className="size-4" />
                    Pause
                  </>
                )}
              </Button>
            )}

            {!isActive && !saving && (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="audio/*"
                  className="hidden"
                  onChange={handleFileUpload}
                />
                <Button
                  size="lg"
                  variant="outline"
                  className="gap-2"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                >
                  {uploading ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <FileUp className="size-4" />
                  )}
                  {uploading ? "Uploading..." : "Upload"}
                </Button>
              </>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
