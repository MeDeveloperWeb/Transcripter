import { serve } from "@hono/node-server"
import { env } from "@my-better-t-app/env/server"
import { Hono } from "hono"
import { cors } from "hono/cors"
import { logger } from "hono/logger"
import { recordings } from "./routes/recordings"
import { chunks } from "./routes/chunks"
import { reconcile } from "./routes/reconcile"
import { transcripts } from "./routes/transcripts"

const app = new Hono()

app.use(logger())
app.use(
  "/*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
  }),
)

app.get("/", (c) => c.text("OK"))

app.route("/api/recordings", recordings)
app.route("/api/chunks", chunks)
app.route("/api/reconcile", reconcile)
app.route("/api/transcripts", transcripts)

app.onError((_err, c) => {
  return c.json({ error: "Internal server error" }, 500)
})

if (process.env.VERCEL !== "1") {
  serve({ fetch: app.fetch, port: 3000 }, (info) => {
    console.log(`Server running on http://localhost:${info.port}`)
  })
}

export default app
