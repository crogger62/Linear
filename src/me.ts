/**
 * me.ts
 * --------------
 * Quick use of API to obtain name of user
 * Co-generated Craig Lewis & Chatgpt
 *
 * Usage:
 *   npx ts-node src/createIssue.ts
 *   npx ts-node src/createIssue.ts --team "Engineering" --title "Customer onboarding checklist"
 * 
 *   Requires Linear API key in .env file
 *   Run with npx ts-node src/createIssue-annotated.ts
 */


import "dotenv/config";
import { LinearClient } from "@linear/sdk";

// cross-fetch polyfill (Node 18+ usually fine, but safe to include)
// import fetch from "cross-fetch";          // Uncomment this and the next line if cross-fetch not in your node version
//(globalThis as any).fetch ??= fetch;

const apiKey = process.env.LINEAR_API_KEY;
if (!apiKey) throw new Error("Missing LINEAR_API_KEY in .env");

const client = new LinearClient({ apiKey });

async function main() {
  const me = await client.viewer;
  console.log({ id: me.id, name: me.name, email: me.email });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});


