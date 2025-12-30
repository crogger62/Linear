/**
 * createIssue.ts
 * -----------------
 * Minimal, production-safe example of creating an issue via the Linear TypeScript SDK.
 *
 * Usage:
 *  npx ts-node src/createIssue.ts
 */

import "dotenv/config";
import { LinearClient } from "@linear/sdk";

// Uncomment next two lines if your Node version lacks global fetch
// import fetch from "cross-fetch";
// (globalThis as any).fetch ??= fetch;

/**
 * Centralized, deterministic key handling:
 * - trims whitespace / CRLF / trailing newlines
 * - fails fast with a clear error if missing
 * - avoids module-scope client construction (prevents "poisoned" clients)
 */
function getLinearClient(): LinearClient {
  const raw = process.env.LINEAR_API_KEY ?? "";
  const apiKey = raw.trim();

  if (!apiKey) {
    throw new Error("Missing or empty LINEAR_API_KEY after trim (check your .env).");
  }

  return new LinearClient({ apiKey });
}

async function main() {
  const client = getLinearClient();

  // Pick first visible team
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

