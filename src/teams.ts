/** Show teams on project
* 
*  Simple script to list all teams visible to the API key, paginated.
* 
* Requires Linear API key in .env file
* Usage:
*
*  Co-generated Craig Lewis & Chatgpt
*/


import dotenv from "dotenv";
import path from "path";
import { LinearClient } from "@linear/sdk";

// Load .env from project root (one level up from src/)
dotenv.config({ path: path.resolve(__dirname, "..", ".env") });

// Uncomment next two lines if your Node version lacks global fetch
//import fetch from "cross-fetch";   // 3) Polyfill fetch for Node environments (SDK expects global fetch).
//(globalThis as any).fetch ??= fetch; // 4) Provide fetch globally if it's not already present.

console.log("[DEBUG] Checking for LINEAR_API_KEY...");
const apiKey = process.env.LINEAR_API_KEY;
if (!apiKey) {
  console.error("[ERROR] Missing LINEAR_API_KEY in .env");
  console.error("[DEBUG] Current working directory:", process.cwd());
  console.error("[DEBUG] Looking for .env at:", path.resolve(__dirname, "..", ".env"));
  throw new Error("Missing LINEAR_API_KEY in .env");
}

console.log("[DEBUG] API key found (length:", apiKey.length, "characters)");
console.log("[DEBUG] Initializing Linear client...");
const client = new LinearClient({ apiKey });
console.log("[DEBUG] Linear client initialized successfully");

async function main() {
  console.log("[DEBUG] Starting to fetch teams...");
  let cursor: string | null | undefined = undefined;
  let page = 1;
  do {
    try {
      console.log(`[DEBUG] Fetching teams page ${page}${cursor ? ` (cursor: ${cursor.substring(0, 20)}...)` : " (first page)"}`);
      const res = await client.teams({ first: 50, after: cursor ?? undefined });
      console.log(`[DEBUG] Received ${res.nodes.length} teams on page ${page}`);
      console.log(`Page ${page} — ${res.nodes.length} teams`);
    for (const t of res.nodes) {
      console.log(`- ${t.name} (id: ${t.id})`);

      // --- Projects for this team (paginated) ---------------------------------
      try {
        console.log(`  [DEBUG] Fetching projects for team: ${t.name}`);
        let pCursor: string | null | undefined = undefined;
        let pPage = 1;
        do {
          // Use the relation method on the team object so the SDK handles scoping.
          console.log(`    [DEBUG] Fetching projects page ${pPage} for team ${t.id}`);
          const pRes = await t.projects({ first: 50, after: pCursor ?? undefined });
          console.log(`    [DEBUG] Received ${pRes.nodes.length} projects on page ${pPage}`);
          if (pRes.nodes.length > 0) console.log(`    Projects page ${pPage} — ${pRes.nodes.length}`);
          for (const p of pRes.nodes) {
            console.log(`      - ${p.name} (id: ${p.id})`);
          }
          pCursor = pRes.pageInfo.hasNextPage ? pRes.pageInfo.endCursor : null;
          pPage += 1;
        } while (pCursor);
      } catch (err) {
        // If the API key doesn't have access to projects, fail gracefully.
        console.error(`    [ERROR] Could not fetch projects for team ${t.id}:`, err);
        console.error(`    [DEBUG] Error details:`, err instanceof Error ? err.message : String(err));
        if (err instanceof Error && err.stack) {
          console.error(`    [DEBUG] Stack trace:`, err.stack);
        }
      }

      // --- Cycles for this team (paginated) -----------------------------------
      try {
        console.log(`  [DEBUG] Fetching cycles for team: ${t.name}`);
        let cCursor: string | null | undefined = undefined;
        let cPage = 1;
        do {
          // Use the team's cycles relation to scope to this team.
          console.log(`    [DEBUG] Fetching cycles page ${cPage} for team ${t.id}`);
          const cRes = await t.cycles({ first: 50, after: cCursor ?? undefined });
          console.log(`    [DEBUG] Received ${cRes.nodes.length} cycles on page ${cPage}`);
          if (cRes.nodes.length > 0) console.log(`    Cycles page ${cPage} — ${cRes.nodes.length}`);
          for (const c of cRes.nodes) {
            // Indicate whether a cycle is active (has started and not ended) using available date fields.
            const now = new Date();
            const startsAt = c.startsAt ? new Date(c.startsAt) : null;
            const endsAt = c.endsAt ? new Date(c.endsAt) : null;
            const active = (startsAt === null || startsAt <= now) && (endsAt === null || endsAt >= now);
            console.log(`      - ${c.name} (id: ${c.id})${active ? ' [active]' : ''}`);
          }
          cCursor = cRes.pageInfo.hasNextPage ? cRes.pageInfo.endCursor : null;
          cPage += 1;
        } while (cCursor);
      } catch (err) {
        console.error(`    [ERROR] Could not fetch cycles for team ${t.id}:`, err);
        console.error(`    [DEBUG] Error details:`, err instanceof Error ? err.message : String(err));
        if (err instanceof Error && err.stack) {
          console.error(`    [DEBUG] Stack trace:`, err.stack);
        }
      }
    }
    cursor = res.pageInfo.hasNextPage ? res.pageInfo.endCursor : null;
    page += 1;
    } catch (err) {
      console.error(`[ERROR] Failed to fetch teams page ${page}:`, err);
      console.error(`[DEBUG] Error details:`, err instanceof Error ? err.message : String(err));
      if (err instanceof Error && err.stack) {
        console.error(`[DEBUG] Stack trace:`, err.stack);
      }
      throw err; // Re-throw to stop execution
    }
  } while (cursor);
  console.log("[DEBUG] Successfully completed fetching all teams");
}

main().catch((e) => {
  console.error("[FATAL ERROR] Script failed:", e);
  console.error("[DEBUG] Error type:", e?.constructor?.name || typeof e);
  console.error("[DEBUG] Error message:", e instanceof Error ? e.message : String(e));
  if (e instanceof Error && e.stack) {
    console.error("[DEBUG] Full stack trace:");
    console.error(e.stack);
  }
  process.exit(1);
});

