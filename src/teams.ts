/** Show teams on project
* 
*  Simple script to list all teams visible to the API key, paginated.
* 
* Requires Linear API key in .env file
* Usage:
*
*  Co-generated Craig Lewis & Chatgpt
*/


import "dotenv/config";
import { LinearClient } from "@linear/sdk";

// Uncomment next two lines if your Node version lacks global fetch
//import fetch from "cross-fetch";   // 3) Polyfill fetch for Node environments (SDK expects global fetch).
//(globalThis as any).fetch ??= fetch; // 4) Provide fetch globally if it's not already present.

const apiKey = process.env.LINEAR_API_KEY;
if (!apiKey) throw new Error("Missing LINEAR_API_KEY in .env");

const client = new LinearClient({ apiKey });

async function main() {
  let cursor: string | null | undefined = undefined;
  let page = 1;
  do {
    const res = await client.teams({ first: 50, after: cursor ?? undefined });
    console.log(`Page ${page} — ${res.nodes.length} teams`);
    for (const t of res.nodes) {
      console.log(`- ${t.name} (id: ${t.id})`);

      // --- Projects for this team (paginated) ---------------------------------
      try {
        let pCursor: string | null | undefined = undefined;
        let pPage = 1;
        do {
          // Use the relation method on the team object so the SDK handles scoping.
          const pRes = await t.projects({ first: 50, after: pCursor ?? undefined });
          if (pRes.nodes.length > 0) console.log(`    Projects page ${pPage} — ${pRes.nodes.length}`);
          for (const p of pRes.nodes) {
            console.log(`      - ${p.name} (id: ${p.id})`);
          }
          pCursor = pRes.pageInfo.hasNextPage ? pRes.pageInfo.endCursor : null;
          pPage += 1;
        } while (pCursor);
      } catch (err) {
        // If the API key doesn't have access to projects, fail gracefully.
        console.warn(`    Could not fetch projects for team ${t.id}: ${String(err)}`);
      }

      // --- Cycles for this team (paginated) -----------------------------------
      try {
        let cCursor: string | null | undefined = undefined;
        let cPage = 1;
        do {
          // Use the team's cycles relation to scope to this team.
          const cRes = await t.cycles({ first: 50, after: cCursor ?? undefined });
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
        console.warn(`    Could not fetch cycles for team ${t.id}: ${String(err)}`);
      }
    }
    cursor = res.pageInfo.hasNextPage ? res.pageInfo.endCursor : null;
    page += 1;
  } while (cursor);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

