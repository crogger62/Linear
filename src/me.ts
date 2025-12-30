/**
 * me.ts
 * --------------
 * Quick use of API to obtain name of user, e.g., whoami
 * Co-generated Craig Lewis & Chatgpt\
 *
 * Usage:
 *   npx ts-node src/me.ts
 *  
 *   Requires Linear API key in .env file
 *
 */


import "dotenv/config";
import { LinearClient } from "@linear/sdk";

function getLinearClient() {
  const raw = process.env.LINEAR_API_KEY ?? "";
  const apiKey = raw.trim();  // normalize

  if (!apiKey) {
    throw new Error("Missing or empty LINEAR_API_KEY after trim");
  }

  return new LinearClient({ apiKey });
}

async function main() {
  const client = getLinearClient(); // construct AFTER validation

  const me = await client.viewer;
  console.log({ id: me.id, name: me.name, email: me.email });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});



