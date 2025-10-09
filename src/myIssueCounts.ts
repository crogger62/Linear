/* counts by workflow state for your assigned issues.*/

import "dotenv/config";
import { LinearClient } from "@linear/sdk";

// Uncomment next two lines if your Node version lacks global fetch
//import fetch from "cross-fetch";   // 3) Polyfill fetch for Node environments (SDK expects global fetch).
//(globalThis as any).fetch ??= fetch; // 4) Provide fetch globally if it's not already present.


const apiKey = process.env.LINEAR_API_KEY;
if (!apiKey) throw new Error("Missing LINEAR_API_KEY in .env");

const client = new LinearClient({ apiKey });

// tiny helper to read a boolean flag like --include-archived
function hasFlag(name: string) {
  return process.argv.includes(`--${name}`);
}

async function main() {
  const includeArchived = hasFlag("include-archived");

  const me = await client.viewer;
  console.log(`Viewer: ${me.name} <${me.email}> (id: ${me.id})`);
  console.log(`Counting issues assigned to you${includeArchived ? " (including archived)" : ""}…\n`);

  const counts = new Map<string, number>(); // key = state.name
  let cursor: string | null | undefined = undefined;
  let total = 0;

  do {
    const page = await client.issues({
      first: 50,
      after: cursor ?? undefined,
      filter: {
        assignee: { id: { eq: me.id } },
        ...(includeArchived ? {} : { archivedAt: { null: true } }),
      },
    });


    for (const issue of page.nodes) {
  // If state is not pre-fetched, fetch it explicitly:
	let stateName = "(No State)";
	try {
    		const state = await issue.state;
    	if (state) stateName = state.name;
  } 	catch {
    	// ignore missing state relation
  	}
  	counts.set(stateName, (counts.get(stateName) ?? 0) + 1);
  	total += 1;
	}	 


    cursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
  } while (cursor);

  // pretty print (sorted by count desc)
  const rows = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const maxStateLen = Math.max(...rows.map(([s]) => s.length), "State".length);
  const pad = (s: string, n: number) => s + " ".repeat(Math.max(0, n - s.length));

  console.log(pad("State", maxStateLen), " | Count");
  console.log("-".repeat(maxStateLen), "-|------");
  for (const [state, count] of rows) {
    console.log(pad(state, maxStateLen), " | ", count.toString().padStart(5, " "));
  }
  console.log("\nTotal issues:", total);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});


