/**
 * createIssue.ts
 * -----------------
 ** Minimal, production-safe example of creating an issue via the Linear TypeScript SDK,
 * with clear annotations for each step (env, client init, team selection, mutation, logging).
 * Adds issue to first team visible to API key.
 * Dummy issue 
 * 
 * Co-generated Craig Lewis & Chatgpt
 * 
 * Usage:
 *  npx ts-node src/createIssue.ts 
 * 
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
  // pick first visible team
  const teams = await client.teams({ first: 1 });
  if (teams.nodes.length === 0) throw new Error("No teams visible to API key.");
  const teamId = teams.nodes[0].id;

  const title = `API-created issue @ ${new Date().toISOString()}`;

  const result = await client.createIssue({
    teamId,
    title,
    // description: "Created via SDK",
  });

  if (!result?.issue) throw new Error("Issue creation returned no issue object.");

  const issue = await result.issue; // LinearFetch<Issue> needs await
  console.log(`✅ Created issue: ${issue.identifier} — "${issue.title}" (id: ${issue.id})`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

