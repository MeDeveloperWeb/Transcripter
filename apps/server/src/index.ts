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
    origin: env.CORS_ORIGIN,
    allowMethods: ["GET", "POST", "OPTIONS"],
  }),
)

app.get("/", (c) => c.text("OK"))

app.route("/api/recordings", recordings)
app.route("/api/chunks", chunks)
app.route("/api/reconcile", reconcile)
app.route("/api/transcripts", transcripts)

export default app
