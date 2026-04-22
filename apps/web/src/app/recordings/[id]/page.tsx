"use client"

import { useEffect, useRef, useState } from "react"
import { useParams } from "next/navigation"
import Link from "next/link"
import {
  Loader2,
  RefreshCw,
  MessageSquare,
  ArrowLeft,
  HardDrive,
  Cloud,
} from "lucide-react"

import { Button } from "@my-better-t-app/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@my-better-t-app/ui/components/card"
import { triggerTranscription, getTranscripts } from "@/lib/api"
import { getLocalAudioUrl } from "@/lib/local-audio-store"
import { useStreamingAudio } from "@/hooks/use-streaming-audio"

interface Utterance {
  speaker: number
  text: string
  start: number
  end: number
}

export default function RecordingPage() {
  const { id } = useParams<{ id: string }>()
  const localAudioUrl = getLocalAudioUrl(id)

  const cloud = useStreamingAudio(id)
  const [utterances, setUtterances] = useState<Utterance[]>([])
  const [transcribing, setTranscribing] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    const load = async () => {
      try {
        const data = await getTranscripts(id)
        if (data.transcript?.status === "completed") {
          setUtterances(data.transcript.utterances as Utterance[])
        }
      } finally {
        setLoaded(true)
      }
    }
    load()
    return () => {
      abortRef.current?.abort()
    }
  }, [id])

  const handleTranscribe = async () => {
    setTranscribing(true)
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    try {
      await triggerTranscription(id)
      const poll = async (attempts = 0): Promise<void> => {
        if (attempts > 60 || controller.signal.aborted) return
        await new Promise((r) => setTimeout(r, 2000))
        if (controller.signal.aborted) return
        try {
          const data = await getTranscripts(id)
          if (controller.signal.aborted) return
          const t = data.transcript
          if (t?.status === "completed") {
            setUtterances(t.utterances as Utterance[])
            return
          }
          if (t?.status === "failed") return
          return poll(attempts + 1)
        } catch {
          if (!controller.signal.aborted) {
            return poll(attempts + 1)
          }
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
      const data = await getTranscripts(id)
      if (data.transcript?.status === "completed") {
        setUtterances(data.transcript.utterances as Utterance[])
      }
    } finally {
      setLoading(false)
    }
  }

  const speakerColors = ["text-blue-400", "text-green-400", "text-purple-400", "text-orange-400"]

  return (
    <div className="container mx-auto flex max-w-lg flex-col items-center gap-6 px-4 py-8">
      <div className="flex w-full items-center gap-3">
        <Link href="/">
          <Button variant="ghost" size="sm" className="gap-1.5">
            <ArrowLeft className="size-3" />
            Back
          </Button>
        </Link>
        <span className="font-mono text-xs text-muted-foreground truncate">{id}</span>
      </div>

      {/* Local Audio */}
      {localAudioUrl && (
        <Card className="w-full">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <HardDrive className="size-4" />
              Local Audio
            </CardTitle>
            <CardDescription>Played from browser memory — available this session only</CardDescription>
          </CardHeader>
          <CardContent>
            <audio controls src={localAudioUrl} className="w-full" preload="auto" />
          </CardContent>
        </Card>
      )}

      {/* Cloud Audio */}
      <Card className="w-full">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Cloud className="size-4" />
            Cloud Audio
          </CardTitle>
          <CardDescription>
            {cloud.loading
              ? "Loading chunks from S3..."
              : `${cloud.loadedCount}/${cloud.totalCount} chunks loaded`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {cloud.loading && cloud.loadedCount === 0 && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Fetching chunks...
            </div>
          )}
          {cloud.audioUrl && (
            <audio
              ref={cloud.setAudioElement}
              controls
              src={cloud.audioUrl}
              className="w-full"
              preload="auto"
            />
          )}
          {!cloud.loading && !cloud.audioUrl && (
            <p className="text-sm text-muted-foreground">No audio chunks found in cloud storage</p>
          )}
        </CardContent>
      </Card>

      {/* Transcript */}
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

          {loaded && utterances.length === 0 && !transcribing && (
            <p className="text-sm text-muted-foreground">No transcript yet. Click Transcribe to start.</p>
          )}

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
    </div>
  )
}
