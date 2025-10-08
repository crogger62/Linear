/*whoami for linear api*/

import "dotenv/config";
import { LinearClient } from "@linear/sdk";

// cross-fetch polyfill (Node 18+ usually fine, but safe to include)
import fetch from "cross-fetch";
(globalThis as any).fetch ??= fetch;

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


