"use client"

import { useCallback, useEffect, useState } from "react"
import { useRouter, usePathname } from "next/navigation"
import { Mic, RefreshCw } from "lucide-react"
import Link from "next/link"

import { Button } from "@my-better-t-app/ui/components/button"
import { listRecordings, type RecordingSummary } from "@/lib/api"

function formatDate(iso: string) {
  const d = new Date(iso)
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) +
    " " +
    d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
}

export default function Sidebar() {
  const router = useRouter()
  const pathname = usePathname()
  const [recordings, setRecordings] = useState<RecordingSummary[]>([])
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setRecordings(await listRecordings())
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load, pathname])

  const activeId = pathname.startsWith("/recordings/")
    ? pathname.split("/recordings/")[1]
    : null

  return (
    <aside className="flex h-full w-64 flex-col border-r border-border bg-muted/10">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <Link href="/" className="flex items-center gap-2 font-semibold text-sm">
          <Mic className="size-4" />
          Recorder
        </Link>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={load}
          disabled={loading}
          aria-label="Refresh recordings"
        >
          <RefreshCw className={`size-3 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      <nav className="flex-1 overflow-y-auto p-2">
        <div className="mb-2 px-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          Recordings
        </div>

        {recordings.length === 0 && !loading && (
          <p className="px-2 text-xs text-muted-foreground">No recordings yet</p>
        )}

        <div className="flex flex-col gap-1">
          {recordings.map((rec) => (
            <button
              key={rec.id}
              type="button"
              onClick={() => router.push(`/recordings/${rec.id}`)}
              className={`flex flex-col gap-0.5 rounded-md px-2.5 py-2 text-left text-xs transition-colors ${
                activeId === rec.id
                  ? "bg-primary/10 text-primary"
                  : "text-foreground hover:bg-muted/50"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-mono truncate max-w-[120px]">{rec.id.slice(-8)}</span>
                <span className={`text-[10px] ${rec.status === "completed" ? "text-green-500" : "text-yellow-500"}`}>
                  {rec.status}
                </span>
              </div>
              <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                <span>{formatDate(rec.createdAt)}</span>
                <span>{rec._count.chunks} chunks</span>
              </div>
            </button>
          ))}
        </div>
      </nav>

      <div className="border-t border-border p-2">
        <Link href="/">
          <Button variant="default" size="sm" className="w-full gap-1.5">
            <Mic className="size-3" />
            New Recording
          </Button>
        </Link>
      </div>
    </aside>
  )
}
