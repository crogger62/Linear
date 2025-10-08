/**
 * webhook-server.ts
 * -----------------
 * A minimal Express app that:
 *  1) Serves a static widget page from ./public (e.g., public/widget.html).
 *  2) Provides a Server-Sent Events (SSE) stream at GET /events for live push updates.
 *  3) Verifies and handles Linear webhooks at POST /linear-webhook using HMAC-SHA256.
 *  4) (Dev) Offers POST /dev/ping to broadcast a test event without Linear.
 *
 * Requirements:
 *   - Node 20+ (global fetch available)
 *   - npm i express body-parser
 *   - npm i -D @types/express @types/body-parser
 *   - .env with:
 *       LINEAR_API_KEY=lin_api_************************
 *       WEBHOOK_SECRET=whsec_**************************
 *
 * Run:
 *   npx ts-node src/webhook-server.ts
 *   (open http://localhost:3000/widget.html)
 *
 * Expose publicly (choose one) and register the webhook in Linear:
 *   ngrok http 3000
 *   cloudflared tunnel --url http://localhost:3000
 */

import "dotenv/config";                           // Load environment variables from .env at startup.
import express, { Request, Response } from "express"; // Express HTTP server framework + request/response types.
import bodyParser from "body-parser";             // Middleware to access the raw request body for signature verification.
import crypto from "crypto";                      // Node crypto for HMAC-SHA256 signature checks.
import path from "path";                          // Path utils to serve static files from ./public.
import { LinearClient } from "@linear/sdk";       // Linear TypeScript SDK to optionally enrich events with API lookups.

// ---- Validate required secrets from environment -----------------------------------------

const API_KEY = process.env.LINEAR_API_KEY;       // Personal/workspace API key for enrichment (optional but helpful).
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET; // Signing secret from Linear webhook settings (shown once on creation).

if (!API_KEY) throw new Error("Missing LINEAR_API_KEY in .env");
if (!WEBHOOK_SECRET) throw new Error("Missing WEBHOOK_SECRET in .env");

// ---- Initialize Linear SDK client -------------------------------------------------------

const linear = new LinearClient({ apiKey: API_KEY }); // Authenticated client used to fetch extra details (e.g., issue title/state).

// ---- Create Express app and basic configuration -----------------------------------------

const app = express();                            // Our HTTP server instance.
const PORT = process.env.PORT ? Number(process.env.PORT) : 3000; // Default to port 3000 unless overridden.

// Serve static files for the widget (e.g., public/widget.html at /widget.html).
app.use(express.static(path.join(process.cwd(), "public"))); // process.cwd() ensures we resolve ./public from project root.

// ---- Capture RAW body bytes BEFORE any JSON parsing (needed for HMAC verification) ------

// Augment Express Request with a rawBody property so TypeScript knows it exists.
type RawRequest = Request & { rawBody?: Buffer };

// bodyParser.raw gives us the exact bytes Linear signed, preserving whitespace/encoding.
app.use(
  bodyParser.raw({
    type: "*/*",                                  // Accept all content types; Linear sends application/json.
    limit: "2mb",                                 // Reasonable default limit for webhook payload size.
    verify: (req: RawRequest, _res, buf) => {
      req.rawBody = buf;                          // Stash the raw buffer on the request for signature verification later.
    },
  })
);

// ---- Server-Sent Events (SSE) wiring ----------------------------------------------------

// Track connected SSE clients so we can broadcast webhook events to all open browsers.
type SSEClient = { id: number; res: Response };   // Each client is an id + its Response stream.
let clients: SSEClient[] = [];                    // In-memory list of currently connected clients.
let nextId = 1;                                   // Auto-incrementing id for client connections.

/**
 * GET /events
 * Opens an SSE stream. The response stays open; we push "event: linear" messages on new webhook arrivals.
 */
app.get("/events", (req, res) => {
  res.set({
    "Content-Type": "text/event-stream",          // SSE content type (text/event-stream).
    "Cache-Control": "no-cache",                  // Disable caching to keep stream live.
    Connection: "keep-alive",                     // Keep TCP connection open.
  });
  // Some proxies/compression layers need the headers flushed:
  (res as any).flushHeaders?.();

  const id = nextId++;                            // Assign a unique id to this client connection.
  clients.push({ id, res });                      // Remember this client so we can push events.

  // Send a small greeting event so the client knows we're connected.
  res.write(`event: hello\ndata: connected\n\n`);

  // Remove the client when the browser tab closes/connection drops.
  req.on("close", () => {
    clients = clients.filter((c) => c.id !== id); // Drop from list to avoid writing to a dead socket.
  });
});

/**
 * Broadcast a JSON-serializable payload to all connected SSE clients as an event named "linear".
 * The browser listens with: ev.addEventListener("linear", handler).
 */
function broadcastEvent(payload: unknown) {
  const data = JSON.stringify(payload);           // Serialize the payload; SSE requires string data.
  for (const c of clients) {
    c.res.write(`event: linear\ndata: ${data}\n\n`); // event name line + data line + blank line terminator.
  }
}

// ---- HMAC signature verification for Linear webhooks ------------------------------------

/**
 * Compute hex(HMAC-SHA256(rawBody, WEBHOOK_SECRET)) and compare against the Linear-Signature header.
 * Linear signs the RAW body bytes; any whitespace/encoding change will alter the digest.
 */
function verifyLinearSignature(rawBody: Buffer, headerValue?: string): boolean {
  if (!headerValue) return false;                 // No signature header → reject.

  // Compute expected signature as a hex string using the shared secret.
  const expectedHex = crypto.createHmac("sha256", WEBHOOK_SECRET as string).update(rawBody).digest("hex");

  // For constant-time comparison, convert to buffers and ensure equal length.
  const expected = Buffer.from(expectedHex, "utf8");
  const received = Buffer.from(headerValue.trim(), "utf8");
  if (expected.length !== received.length) return false;

  try {
    return crypto.timingSafeEqual(expected, received); // timing-safe to avoid leak via timing attacks.
  } catch {
    return false;                                      // Any error → treat as invalid.
  }
}

// ---- Webhook endpoint: verify, parse, optionally enrich, then broadcast & ACK ------------

/**
 * POST /linear-webhook
 * Main entry point for Linear to deliver events. Must:
 *  1) Verify Linear-Signature using HMAC-SHA256 of the raw body.
 *  2) Parse JSON safely after verification.
 *  3) Optionally enrich with Linear API (e.g., look up issue title/state).
 *  4) Broadcast to SSE clients so the widget updates live.
 *  5) Respond quickly with 200 OK.
 */
app.post("/linear-webhook", async (req: RawRequest, res: Response) => {
  try {
    const signature = req.header("Linear-Signature");  // Header name used by Linear for the HMAC signature.
    const raw = req.rawBody ?? Buffer.from("");        // Raw bytes captured by bodyParser.raw.

    // 1) Verify authenticity before trusting the payload.
    if (!verifyLinearSignature(raw, signature)) {
      console.warn("⚠️  Invalid Linear-Signature; rejecting request");
      return res.status(401).send("Invalid signature"); // Unauthorized → do not process further.
    }

    // 2) Safe to parse the JSON now that integrity/authenticity checks passed.
    const event = JSON.parse(raw.toString("utf8")) as {
      type?: string;                                    // e.g., "Issue"
      action?: string;                                  // e.g., "create" | "update"
      data?: { id?: string; type?: string };            // payload with entity id and optional type.
    };

    // Minimal console log for operator visibility.
    const entityId = event?.data?.id ?? "(no id)";
    console.log(`📬 Event: type=${event?.type ?? "?"} action=${event?.action ?? "?"} id=${entityId}`);

    // 3) OPTIONAL: try to enrich if it's an Issue (fetch title, team, state).
    if (event?.data?.id && (event?.type?.toLowerCase().includes("issue") || event?.data?.type === "Issue")) {
      try {
        const issue = await linear.issue(event.data.id); // SDK lookup by id.
        const state = await issue.state;                 // Lazy relation fetch for workflow state.
        const team = await issue.team;                   // Lazy relation fetch for team.
        console.log(`   ↳ ${issue.identifier}: "${issue.title}" • state=${state?.name ?? "?"} • team=${team?.name ?? "?"}`);
      } catch {
        // If the entity isn't an issue or the API key lacks access, ignore enrichment errors.
      }
    }

    // 4) Push the event to any open browser widgets via SSE (prepend a timestamp).
    broadcastEvent({ receivedAt: new Date().toISOString(), ...event });

    // 5) ACK quickly; do not perform long-running tasks inline (use queues/workers if needed).
    return res.status(200).send("ok");
  } catch (err) {
    console.error("Webhook handler error:", err);       // One final catch to avoid unhandled rejections.
    return res.status(500).send("server error");        // Tell Linear we failed; it may retry per its policy.
  }
});

// ---- Development convenience: manual broadcast without signature (local only) ------------

/**
 * POST /dev/ping
 * Sends a synthetic event to all SSE clients. Handy to test the widget before wiring Linear.
 * NOTE: Keep this route ONLY for local development; remove or protect it in any deployed environment.
 */
app.post("/dev/ping", (_req: Request, res: Response) => {
  broadcastEvent({
    receivedAt: new Date().toISOString(),
    type: "DevPing",
    action: "test",
    data: { note: "hello from dev" },
  });
  res.status(200).send("pinged");
});

// ---- Health check -----------------------------------------------------------------------

/**
 * GET /
 * Simple health endpoint so you can see the server is up (useful with ngrok/cloudflared probes).
 */
app.get("/", (_req: Request, res: Response) => {
  res.send("Linear webhook server up");
});

// ---- Start server -----------------------------------------------------------------------

app.listen(PORT, () => {
  console.log(`🚀 Listening on http://localhost:${PORT}`);                 // Local base URL.
  console.log(`   Widget:   http://localhost:${PORT}/widget.html`);       // Static widget page.
  console.log(`   SSE feed: http://localhost:${PORT}/events`);            // SSE endpoint used by the widget.
  console.log(`   Webhook:  POST http://localhost:${PORT}/linear-webhook`); // Linear should POST here.
});


