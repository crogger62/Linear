/* Show teams on project*/


import "dotenv/config";
import { LinearClient } from "@linear/sdk";
import fetch from "cross-fetch";
(globalThis as any).fetch ??= fetch;

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
    }
    cursor = res.pageInfo.hasNextPage ? res.pageInfo.endCursor : null;
    page += 1;
  } while (cursor);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

