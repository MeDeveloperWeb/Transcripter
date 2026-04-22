"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import {
  Download,
  Mic,
  Pause,
  Play,
  Square,
  Trash2,
  Check,
  Upload,
  Loader2,
  AlertCircle,
  RefreshCw,
  MessageSquare,
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
import { useRecorder, type WavChunk } from "@/hooks/use-recorder"
import {
  useUploadPipeline,
  type TrackedChunk,
  type ChunkUploadStatus,
} from "@/hooks/use-upload-pipeline"
import { triggerTranscription, getTranscripts } from "@/lib/api"

function formatTime(seconds: number) {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  const ms = Math.floor((seconds % 1) * 10)
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${ms}`
}

function formatDuration(seconds: number) {
  return `${seconds.toFixed(1)}s`
}

const STATUS_CONFIG: Record<ChunkUploadStatus, { icon: typeof Check; label: string; className: string }> = {
  saving: { icon: Loader2, label: "Saving to OPFS", className: "text-yellow-500 animate-spin" },
  saved: { icon: Check, label: "Saved locally", className: "text-blue-500" },
  uploading: { icon: Upload, label: "Uploading", className: "text-yellow-500 animate-spin" },
  acked: { icon: Check, label: "Synced", className: "text-green-500" },
  failed: { icon: AlertCircle, label: "Failed", className: "text-red-500" },
}

function ChunkRow({ chunk, tracked, index }: { chunk: WavChunk; tracked?: TrackedChunk; index: number }) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)

  const toggle = () => {
    const el = audioRef.current
    if (!el) return
    if (playing) {
      el.pause()
      el.currentTime = 0
      setPlaying(false)
    } else {
      el.play()
      setPlaying(true)
    }
  }

  const download = () => {
    const a = document.createElement("a")
    a.href = chunk.url
    a.download = `chunk-${index + 1}.wav`
    a.click()
  }

  const status = tracked ? STATUS_CONFIG[tracked.uploadStatus] : null
  const StatusIcon = status?.icon

  return (
    <div className="flex items-center justify-between gap-3 rounded-sm border border-border/50 bg-muted/30 px-3 py-2">
      <audio
        ref={audioRef}
        src={chunk.url}
        onEnded={() => setPlaying(false)}
        preload="none"
      />
      <span className="text-xs font-medium text-muted-foreground tabular-nums">
        #{index + 1}
      </span>
      <span className="text-xs tabular-nums">{formatDuration(chunk.duration)}</span>
      <span className="text-[10px] text-muted-foreground">16kHz PCM</span>

      {StatusIcon && (
        <span className={`flex items-center gap-1 text-[10px] ${status.className}`}>
          <StatusIcon className="size-3" />
          {status.label}
          {tracked && tracked.retryCount > 0 && ` (retry ${tracked.retryCount})`}
        </span>
      )}

      <div className="ml-auto flex gap-1">
        <Button variant="ghost" size="icon-xs" onClick={toggle} aria-label={playing ? "Stop playback" : "Play chunk"}>
          {playing ? <Square className="size-3" /> : <Play className="size-3" />}
        </Button>
        <Button variant="ghost" size="icon-xs" onClick={download} aria-label="Download chunk">
          <Download className="size-3" />
        </Button>
      </div>
    </div>
  )
}

interface Utterance {
  speaker: number
  text: string
  start: number
  end: number
}

function TranscriptView({ recordingId }: { recordingId: string }) {
  const [utterances, setUtterances] = useState<Utterance[]>([])
  const [loading, setLoading] = useState(false)
  const [transcribing, setTranscribing] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    return () => {
      abortRef.current?.abort()
    }
  }, [])

  const handleTranscribe = async () => {
    setTranscribing(true)
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    try {
      await triggerTranscription(recordingId)
      const poll = async (attempts = 0): Promise<void> => {
        if (attempts > 30 || controller.signal.aborted) return
        await new Promise((r) => setTimeout(r, 2000))
        if (controller.signal.aborted) return
        const data = await getTranscripts(recordingId)
        if (controller.signal.aborted) return
        const allDone = data.chunks.every(
          (ch) => ch.transcript?.status === "completed" || ch.transcript?.status === "failed",
        )
        const allUtterances = data.chunks
          .flatMap((ch) =>
            ch.transcript?.status === "completed"
              ? (ch.transcript.utterances as Utterance[])
              : [],
          )
        setUtterances(allUtterances)
        if (!allDone) {
          return poll(attempts + 1)
        }
      }
      await poll()
    } finally {
      setTranscribing(false)
    }
  }

  const handleRefresh = async () => {
    setLoading(true)
    try {
      const data = await getTranscripts(recordingId)
      const allUtterances = data.chunks.flatMap((ch) =>
        ch.transcript?.status === "completed"
          ? (ch.transcript.utterances as Utterance[])
          : [],
      )
      setUtterances(allUtterances)
    } finally {
      setLoading(false)
    }
  }

  const speakerColors = ["text-blue-400", "text-green-400", "text-purple-400", "text-orange-400"]

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MessageSquare className="size-4" />
          Transcript
        </CardTitle>
        <CardDescription>Speaker diarization via Deepgram Nova-3</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex gap-2">
          <Button
            size="sm"
            onClick={handleTranscribe}
            disabled={transcribing}
            className="gap-1.5"
          >
            {transcribing ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <MessageSquare className="size-3" />
            )}
            {transcribing ? "Transcribing..." : "Transcribe"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={handleRefresh}
            disabled={loading}
            className="gap-1.5"
          >
            <RefreshCw className={`size-3 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>

        {utterances.length > 0 && (
          <div className="flex flex-col gap-2 rounded-sm border border-border/50 bg-muted/20 p-3">
            {utterances.map((u, i) => (
              <div key={`${u.start}-${i}`} className="flex gap-2 text-sm">
                <span className={`font-medium ${speakerColors[u.speaker % speakerColors.length]}`}>
                  Speaker {u.speaker}:
                </span>
                <span>{u.text}</span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export default function RecorderPage() {
  const [deviceId] = useState<string | undefined>()
  const pipeline = useUploadPipeline()
  const [sessionStarted, setSessionStarted] = useState(false)
  const [recordingDone, setRecordingDone] = useState(false)

  const onChunk = useCallback(
    (chunk: WavChunk) => {
      pipeline.processChunk(chunk)
    },
    [pipeline.processChunk],
  )

  const { status, start, stop, pause, resume, chunks, elapsed, stream, clearChunks } =
    useRecorder({ chunkDuration: 5, deviceId, onChunk })

  const isRecording = status === "recording"
  const isPaused = status === "paused"
  const isActive = isRecording || isPaused

  const handlePrimary = useCallback(async () => {
    if (isActive) {
      stop()
      await pipeline.endSession()
      setRecordingDone(true)
    } else {
      await pipeline.startSession()
      setSessionStarted(true)
      setRecordingDone(false)
      start()
    }
  }, [isActive, stop, start, pipeline])

  const handleClear = useCallback(() => {
    clearChunks()
    pipeline.cleanup()
    setSessionStarted(false)
    setRecordingDone(false)
  }, [clearChunks, pipeline])

  const ackedCount = pipeline.trackedChunks.filter((t) => t.uploadStatus === "acked").length
  const failedCount = pipeline.trackedChunks.filter((t) => t.uploadStatus === "failed").length

  return (
    <div className="container mx-auto flex max-w-lg flex-col items-center gap-6 px-4 py-8">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>Recorder</CardTitle>
          <CardDescription>16 kHz / 16-bit PCM WAV — chunked every 5 s</CardDescription>
        </CardHeader>

        <CardContent className="flex flex-col gap-6">
          {/* Waveform */}
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

          {/* Timer */}
          <div className="text-center font-mono text-3xl tabular-nums tracking-tight">
            {formatTime(elapsed)}
          </div>

          {/* Pipeline Status */}
          {sessionStarted && (
            <div className="flex items-center justify-center gap-4 text-xs text-muted-foreground">
              <span className="text-green-500">{ackedCount} synced</span>
              {failedCount > 0 && <span className="text-red-500">{failedCount} failed</span>}
              {pipeline.pipelineError && (
                <span className="text-red-500">{pipeline.pipelineError}</span>
              )}
            </div>
          )}

          {/* Controls */}
          <div className="flex items-center justify-center gap-3">
            <Button
              size="lg"
              variant={isActive ? "destructive" : "default"}
              className="gap-2 px-5"
              onClick={handlePrimary}
              disabled={status === "requesting"}
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

            {recordingDone && failedCount > 0 && (
              <Button
                size="lg"
                variant="outline"
                className="gap-2"
                onClick={pipeline.reconcile}
                disabled={pipeline.isReconciling}
              >
                <RefreshCw className={`size-4 ${pipeline.isReconciling ? "animate-spin" : ""}`} />
                Reconcile
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Chunks */}
      {chunks.length > 0 && (
        <Card className="w-full">
          <CardHeader>
            <CardTitle>Chunks</CardTitle>
            <CardDescription>{chunks.length} recorded</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {chunks.map((chunk, i) => (
              <ChunkRow
                key={chunk.id}
                chunk={chunk}
                tracked={pipeline.trackedChunks[i]}
                index={i}
              />
            ))}
            <Button
              variant="ghost"
              size="sm"
              className="mt-2 gap-1.5 self-end text-destructive"
              onClick={handleClear}
            >
              <Trash2 className="size-3" />
              Clear all
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Transcript */}
      {recordingDone && pipeline.recordingId && (
        <TranscriptView recordingId={pipeline.recordingId} />
      )}
    </div>
  )
}
