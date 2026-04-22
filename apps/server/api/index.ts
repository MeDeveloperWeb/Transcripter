let handler: ReturnType<typeof import("hono/vercel").handle> | null = null
let initError: string | null = null

try {
  const { handle } = await import("hono/vercel")
  const { default: app } = await import("../src/index")
  handler = handle(app)
} catch (e) {
  initError = e instanceof Error ? e.message + "\n" + e.stack : String(e)
  console.error("INIT ERROR:", initError)
}

const fallback = (req: Request) =>
  new Response(JSON.stringify({ error: initError }), {
    status: 500,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  })

export const GET = handler ?? fallback
export const POST = handler ?? fallback
export const PUT = handler ?? fallback
export const DELETE = handler ?? fallback
export const OPTIONS = handler ?? fallback
