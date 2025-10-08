/**
 * createIssue.ts
 * --------------
 * Minimal, production-safe example of creating an issue via the Linear TypeScript SDK,
 * with clear annotations for each step (env, client init, team selection, mutation, logging).
 *
 * Usage:
 *   npx ts-node src/createIssue.ts
 *   npx ts-node src/createIssue.ts --team "Engineering" --title "Customer onboarding checklist"
 */

import "dotenv/config";            // 1) Load .env before anything else so process.env is populated.
import { LinearClient } from "@linear/sdk"; // 2) Official Linear SDK (typed GraphQL client).
import fetch from "cross-fetch";   // 3) Polyfill fetch for Node environments (SDK expects global fetch).
(globalThis as any).fetch ??= fetch; // 4) Provide fetch globally if it's not already present.

// 5) Read and validate the API key from .env (LINEAR_API_KEY=lin_api_...).
const apiKey = process.env.LINEAR_API_KEY;
if (!apiKey) throw new Error("Missing LINEAR_API_KEY in .env");

// 6) Construct the SDK client. This authenticates every subsequent call.
const linear = new LinearClient({ apiKey });

// 7) Tiny CLI arg helpers, so we can pass --team and --title from the command line.
function getArg(flag: string): string | undefined {
  const i = process.argv.indexOf(`--${flag}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

// 8) Optional inputs:
//    --team  "Team Name"  (choose a specific team by name)
//    --title "Issue title" (otherwise defaults to a timestamped title)
const teamNameArg = getArg("team");
const titleArg = getArg("title");

// 9) Everything in an async main so we can use await cleanly and handle errors centrally.
async function main() {
  // 10) Identify the current user (useful for logging & debugging).
  const me = await linear.viewer;
  console.log(`Viewer: ${me.name} <${me.email}> (id: ${me.id})`);

  // 11) Resolve a teamId to create the issue under.
  //     If --team is provided, search all teams by name (case-insensitive).
  //     Otherwise, fall back to "first visible team".
  let teamId: string | undefined;

  if (teamNameArg) {
    let cursor: string | null | undefined = undefined;
    do {
      // 12) Paginate through teams (connections use { first, after, pageInfo }).
      const page = await linear.teams({ first: 50, after: cursor ?? undefined });

      // 13) Try to find a matching team by name.
      const hit = page.nodes.find(
        t => t.name.toLowerCase() === teamNameArg.toLowerCase()
      );
      if (hit) {
        teamId = hit.id;
        break;
      }

      // 14) Continue pagination if more pages exist.
      cursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
    } while (cursor);

    if (!teamId) {
      throw new Error(`No team found with name: "${teamNameArg}". Check your spelling and visibility.`);
    }
  } else {
    // 15) No --team provided: just take the first visible team for the API key.
    const firstPage = await linear.teams({ first: 1 });
    if (firstPage.nodes.length === 0) {
      throw new Error("No teams visible to this API key. Verify scopes and workspace access.");
    }
    teamId = firstPage.nodes[0].id;
  }

  // 16) Prepare a reasonable default title if none was passed.
  const title = titleArg ?? `API-created issue @ ${new Date().toISOString()}`;

  // 17) Perform the mutation via the SDK. This wraps the GraphQL issueCreate(input: {...}).
  //     NOTE: The non-null assertion (!) tells TypeScript we *know* teamId is defined here.
  //     It has no runtime effect—purely a compile-time hint.
  const result = await linear.createIssue({
    teamId: teamId!,       // <- non-null assertion: we validated teamId above
    title,                 // required
    // description: "Created via SDK", // optional: you can supply any of these next fields as needed
    // priority: 2,                    // optional (1=Urgent, 2=High, 3=Medium, 4=Low; varies by workspace)
    // assigneeId: "...",              // optional
    // stateId: "...",                 // optional
    // projectId: "...",               // optional
    // labelIds: ["...", "..."],       // optional
    // cycleId: "...",                 // optional
    // parentId: "...",                // optional (for sub-issues)
  });

  // 18) Result is a response wrapper with a lazy 'issue' field: LinearFetch<Issue>.
  //     You must await it to get the actual Issue object.
  if (!result?.issue) {
    throw new Error("Issue creation returned no issue object (unexpected).");
  }
  const issue = await result.issue;

  // 19) Success logging: identifier is the human-friendly key (e.g., ENG-123).
  console.log(`✅ Created issue: ${issue.identifier} — "${issue.title}" (id: ${issue.id})`);
}

// 20) Centralized error handling to exit with a non-zero code if anything fails.
main().catch(err => {
  console.error("❌ Failed to create issue:", err);
  process.exit(1);
});

