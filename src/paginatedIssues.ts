/**
*paginatedIssues.ts 
* Exploring how cursors and pagination work in the Linear SDK.

 */


import "dotenv/config";
import { LinearClient, Issue } from "@linear/sdk";
// Uncomment next two lines if your Node version lacks global fetch
//import fetch from "cross-fetch";   // 3) Polyfill fetch for Node environments (SDK expects global fetch).
//(globalThis as any).fetch ??= fetch; // 4) Provide fetch globally if it's not already present.

const apiKey = process.env.LINEAR_API_KEY;
if (!apiKey) throw new Error("Missing LINEAR_API_KEY in .env");

const client = new LinearClient({ apiKey });

/** ---- main ---- */

async function main(): Promise<void> {
  const viewer = await client.viewer;
  console.log(`Viewer: ${viewer.name} <${viewer.email}> (id: ${viewer.id})`);


  const counts = new Map<string, number>();
  let totalFetched = 0;
  let totalMatched = 0;

  let cursor: string | null | undefined = undefined;
    do {
        const res = await client.issues({ first: 25, after: cursor });
        cursor = res.pageInfo.hasNextPage ? res.pageInfo.endCursor : null;

            for (const issue of page.nodes) {
      totalFetched += 1;

      // 21) Filter by label if specified.
      if (labelName) {
        const hasLabel = await issueHasLabelByName(issue, labelName);
        if (!hasLabel) continue; // skip if label missing
      }

      // 22) Filter by workflow state if specified.
      if (wantedState) {
        const st = await issueStateName(issue);
        if (st.toLowerCase() !== wantedState.toLowerCase()) continue;
      }

      // 23) Count by state name.
      const stateName = await issueStateName(issue);
      counts.set(stateName, (counts.get(stateName) ?? 0) + 1);
      totalMatched += 1;
    }
    } while (cursor);

}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

