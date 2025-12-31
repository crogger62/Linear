/**
 * customerRequests-server.ts
 * --------------------------
 * A minimal Express app that serves a picker UI to select a Project, an Issue, or None
 * and then runs src/customerRequests.ts with the appropriate flags. It also streams
 * run output via Server-Sent Events (SSE).
 *
 * Requirements:
 *   - Node 20+
 *   - npm i express body-parser
 *   - npm i -D @types/express @types/body-parser
 *   - .env with:
 *       LINEAR_API_KEY=lin_api_************************
 *
 * Run:
 *   npx ts-node src/customerRequests-server.ts
 *   (open http://localhost:3100/picker.html)
 */

import "dotenv/config";
import express, { Request, Response } from "express";
import bodyParser from "body-parser";
import path from "path";
import { LinearClient, Issue, Project } from "@linear/sdk";
import { spawn } from "node:child_process";

// Debug flag - enable with --debug flag or DEBUG=true env var
const DEBUG = process.env.DEBUG === "true" || process.argv.includes("--debug");

function debugLog(...args: any[]) {
  if (DEBUG) {
    console.log("[DEBUG]", ...args);
  }
}

/**
 * Deterministic key handling:
 * - trims whitespace / CRLF / trailing newlines
 * - fails fast if missing/empty
 * - avoids module-scope client construction (prevents accidental "poisoned" clients)
 *
 * Also ensures child processes inherit a normalized key.
 */
function getLinearApiKey(): string {
  const raw = process.env.LINEAR_API_KEY ?? "";
  debugLog("Raw LINEAR_API_KEY length:", raw.length);
  debugLog("Raw LINEAR_API_KEY present:", !!raw);
  const apiKey = raw.trim();
  debugLog("Trimmed API key length:", apiKey.length);

  if (!apiKey) {
    throw new Error("Missing or empty LINEAR_API_KEY after trim (check your .env).");
  }

  // Normalize process.env so any spawned children inherit a clean value.
  process.env.LINEAR_API_KEY = apiKey;
  debugLog("API key validated successfully");
  return apiKey;
}

function getLinearClient(): LinearClient {
  const apiKey = getLinearApiKey();
  return new LinearClient({ apiKey });
}

const app = express();
const PORT = process.env.PICKER_PORT ? Number(process.env.PICKER_PORT) : 3100;

// Construct client after key normalization/validation
const linear = getLinearClient();

// Serve static files from ./public (picker.html lives here)
app.use(express.static(path.join(process.cwd(), "public")));
app.use(bodyParser.json());

// Simple paginator helper matching repo style
async function paginate<T>(
  fetch: (after?: string | null) => Promise<{
    nodes: T[];
    pageInfo: { hasNextPage: boolean; endCursor?: string | null };
  }>
): Promise<T[]> {
  const out: T[] = [];
  let after: string | null | undefined = null;
  do {
    const page = await fetch(after);
    out.push(...page.nodes);
    after = page.pageInfo.hasNextPage ? (page.pageInfo.endCursor ?? null) : null;
  } while (after);
  return out;
}

// -------------------------- Data endpoints --------------------------

app.get("/api/projects", async (_req: Request, res: Response) => {
  try {
    const projects = await paginate<Project>((after) => linear.projects({ first: 50, after }));
    const mapped = projects.map((p) => ({ id: p.id, name: p.name ?? "(Unnamed Project)" }));
    mapped.sort((a, b) => a.name.localeCompare(b.name));
    res.json({ projects: mapped });
  } catch (err) {
    console.error("/api/projects error:", err);
    res.status(500).json({ error: "Failed to fetch projects" });
  }
});

app.get("/api/issues", async (req: Request, res: Response) => {
  try {
    const query = (req.query.query as string | undefined)?.trim();
    const limit = Math.max(1, Math.min(500, Number(req.query.limit ?? 200)));

    // If query looks like TEAM-123, try to fetch that directly
    const identMatch = query && query.match(/^([A-Za-z]+)-(\d+)$/);
    if (identMatch) {
      const teamKey = identMatch[1].toUpperCase();
      const issueNumber = parseInt(identMatch[2], 10);
      const nodes = await paginate<Issue>((after) =>
        linear.issues({
          first: 50,
          after,
          filter: { number: { eq: issueNumber }, team: { key: { eq: teamKey } } },
        })
      );
      const items = nodes.slice(0, limit).map((i) => ({ id: i.id, identifier: i.identifier, title: i.title ?? "" }));
      return res.json({ issues: items });
    }

    // Otherwise fetch recent issues and optionally filter by title
    // We limit to a few pages to avoid huge payloads
    const result: Issue[] = [];
    let after: string | null | undefined = null;
    let fetched = 0;
    do {
      const page = await linear.issues({ first: 50, after });
      result.push(...page.nodes);
      fetched += page.nodes.length;
      after = page.pageInfo.hasNextPage && fetched < 500 ? (page.pageInfo.endCursor ?? null) : null;
    } while (after);

    let items = result;
    if (query) {
      const q = query.toLowerCase();
      items = items.filter((i) => (i.title ?? "").toLowerCase().includes(q) || i.identifier.toLowerCase().includes(q));
    }
    items = items.slice(0, limit);
    res.json({ issues: items.map((i) => ({ id: i.id, identifier: i.identifier, title: i.title ?? "" })) });
  } catch (err) {
    console.error("/api/issues error:", err);
    res.status(500).json({ error: "Failed to fetch issues" });
  }
});

// ------------------------------ SSE --------------------------------

type RunClient = { id: number; res: Response };
const runStreams = new Map<string, RunClient[]>();
let nextClientId = 1;

app.get("/run-events", (req: Request, res: Response) => {
  const runId = String(req.query.runId || "");
  if (!runId) return res.status(400).send("Missing runId");

  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  (res as any).flushHeaders?.();

  const id = nextClientId++;
  const arr = runStreams.get(runId) ?? [];
  arr.push({ id, res });
  runStreams.set(runId, arr);

  res.write(`event: hello\ndata: connected\n\n`);
  req.on("close", () => {
    const list = runStreams.get(runId) ?? [];
    runStreams.set(runId, list.filter((c) => c.id !== id));
  });
});

function emitRun(runId: string, payload: Record<string, unknown>) {
  const data = JSON.stringify({ runId, ...payload });
  const list = runStreams.get(runId) ?? [];
  for (const c of list) c.res.write(`event: run\ndata: ${data}\n\n`);
}

// ------------------------------ Runner ------------------------------

app.post("/api/run", async (req: Request, res: Response) => {
  try {
    const { type, id } = req.body as { type: "none" | "project" | "issue"; id?: string };
    if (!type || (type !== "none" && !id)) return res.status(400).json({ error: "Invalid selection" });

    const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    res.status(202).json({ runId });

    const args = ["ts-node", "src/customerRequests.ts"];
    if (type === "project") args.push("--project-id", id!);
    else if (type === "issue") args.push("--issue-id", id!);

    // Ensure child inherits normalized key (and keep rest of env intact)
    const childEnv = { ...process.env, LINEAR_API_KEY: getLinearApiKey() };

    // Use npx so ts-node is resolved similarly to CLI usage
    const child = spawn("npx", args, { cwd: process.cwd(), env: childEnv });
    emitRun(runId, { status: "started", cmd: `npx ${args.join(" ")}` });

    child.stdout.on("data", (buf) => emitRun(runId, { stream: "stdout", line: buf.toString("utf8") }));
    child.stderr.on("data", (buf) => emitRun(runId, { stream: "stderr", line: buf.toString("utf8") }));
    child.on("close", (code) => emitRun(runId, { status: "finished", code }));
    child.on("error", (err) => emitRun(runId, { status: "error", message: String(err) }));
  } catch (err) {
    console.error("/api/run error:", err);
    res.status(500).json({ error: "Failed to start run" });
  }
});

// Run analysis command (defaults to analyze_feedback.py on CustomerRequests.csv)
app.post("/api/analyze", async (_req: Request, res: Response) => {
  try {
    const cmd = "bash";
    const args = ["-lc", "./run_analysis.sh"];

    const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    res.status(202).json({ runId });

    // Ensure child inherits normalized key (and keep rest of env intact)
    const childEnv = { ...process.env, LINEAR_API_KEY: getLinearApiKey() };

    const child = spawn(cmd, args, { cwd: process.cwd(), env: childEnv });
    emitRun(runId, { status: "started", cmd: `${cmd} ${args.join(" ")}` });

    child.stdout.on("data", (buf) => emitRun(runId, { stream: "stdout", line: buf.toString("utf8") }));
    child.stderr.on("data", (buf) => emitRun(runId, { stream: "stderr", line: buf.toString("utf8") }));
    child.on("close", (code) => emitRun(runId, { status: "finished", code }));
    child.on("error", (err) => emitRun(runId, { status: "error", message: String(err) }));
  } catch (err) {
    console.error("/api/analyze error:", err);
    res.status(500).json({ error: "Failed to start analysis" });
  }
});

// Serve generated insights.html content so the UI can embed it
app.get("/api/insights", async (_req: Request, res: Response) => {
  try {
    const filePath = path.join(process.cwd(), "insights.html");
    res.sendFile(filePath, (err) => {
      if (err) {
        console.error("/api/insights sendFile error:", err);
        const status = (err as any)?.status || 500;
        res.status(status).send("insights.html not available");
      }
    });
  } catch (err) {
    console.error("/api/insights error:", err);
    res.status(500).send("Failed to load insights.html");
  }
});

// Health
app.get("/", (_req, res) => res.send("Customer Requests picker server up"));

// Catch unhandled promise rejections
process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise);
  console.error("Reason:", reason);
  if (DEBUG) {
    console.error("Stack:", reason instanceof Error ? reason.stack : String(reason));
  }
  // Don't exit - keep server running, but log the error
});

// Catch uncaught exceptions
process.on("uncaughtException", (error) => {
  console.error("Uncaught Exception:", error.message);
  if (DEBUG) {
    console.error("Stack:", error.stack);
  }
  // Exit on uncaught exceptions (they're usually fatal)
  process.exit(1);
});

// Catch process signals to see if something is killing the process
process.on("SIGTERM", () => {
  debugLog("Received SIGTERM signal");
  process.exit(0);
});

process.on("SIGINT", () => {
  debugLog("Received SIGINT signal (Ctrl+C)");
  process.exit(0);
});

process.on("exit", (code) => {
  debugLog(`Process exiting with code: ${code}`);
});

const server = app.listen(PORT, () => {
  console.log(`Picker listening on http://localhost:${PORT}`);
  console.log(`Open http://localhost:${PORT}/picker.html`);
  debugLog("Server started successfully, process PID:", process.pid);
  debugLog("Node version:", process.version);
  debugLog("Server should keep running - if it exits, check the logs above");
  
  // Keepalive: log every 5 seconds in debug mode to confirm process is alive
  if (DEBUG) {
    setInterval(() => {
      debugLog("Server still running...", new Date().toISOString());
    }, 5000);
  }
});

server.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    console.error(`\n❌ Port ${PORT} is already in use.`);
    console.error(`   Another instance of the server may already be running.`);
    console.error(`   To find and stop it, run: lsof -ti :${PORT} | xargs kill`);
    console.error(`   Or use a different port: PICKER_PORT=3101 npx ts-node src/customerRequests-server.ts\n`);
    process.exit(1);
  } else {
    console.error("Server error:", err);
    process.exit(1);
  }
});


