/**
 * issuesFiltered-annotated.ts
 * -----------------
 * Demonstrates advanced filtering of issues via the Linear TypeScript SDK.
 * Filters: assignee email, label name, state name, "updated since N days", include archived.
 * Outputs: count of matching issues grouped by workflow state.
 *
 * Usage examples:
 *   npx ts-node src/issuesFiltered.ts --since 7
 *   npx ts-node src/issuesFiltered.ts --email "teammate@company.com" --label "Needs Triage"
 *   npx ts-node src/issuesFiltered.ts --state "In Progress" --include-archived
 * 
 *  * Co-generated Craig Lewis & Chatgpt

 */

import "dotenv/config";             // 1) Load LINEAR_API_KEY from .env before anything else.
import { LinearClient, Issue } from "@linear/sdk";  // 2) Import typed SDK classes.
import fetch from "cross-fetch";    // 3) Polyfill fetch (SDK relies on globalThis.fetch).
(globalThis as any).fetch ??= fetch; // 4) Make sure fetch exists globally (Node ≤20 needs this).

// 5) Validate API key.
const apiKey = process.env.LINEAR_API_KEY;
if (!apiKey) throw new Error("Missing LINEAR_API_KEY in .env");

// 6) Initialize the SDK client once; all calls reuse it.
const client = new LinearClient({ apiKey });

/* ------------------------------------------------------------
   Utility helpers for parsing CLI args like --email foo@bar.com
------------------------------------------------------------- */

// 7) Return the value following a flag, e.g., --email someone → "someone".
function getArg(flag: string): string | undefined {
  const i = process.argv.indexOf(`--${flag}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

// 8) Check for boolean flags (no following value), e.g., --include-archived.
function hasFlag(flag: string): boolean {
  return process.argv.includes(`--${flag}`);
}

// 9) Collect possible CLI parameters.
const email = getArg("email");            // optional: assignee email
const labelName = getArg("label");        // optional: label to match
const wantedState = getArg("state");      // optional: workflow state name
const sinceDays = Number(getArg("since") ?? "0"); // optional: only updated in last N days
const includeArchived = hasFlag("include-archived"); // optional toggle

/* ------------------------------------------------------------
   Helper functions to resolve IDs and related data
------------------------------------------------------------- */

// 10) Find a user ID by email (SDK doesn't have direct search, so we page through).
async function findUserIdByEmail(email: string): Promise<string | null> {
  let cursor: string | null | undefined = undefined;
  do {
    const page = await client.users({ first: 50, after: cursor ?? undefined });
    const hit = page.nodes.find(u => u.email?.toLowerCase() === email.toLowerCase());
    if (hit) return hit.id;
    cursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
  } while (cursor);
  return null;
}

// 11) Check if an issue has a label with a given name (client-side).
async function issueHasLabelByName(issue: Issue, name: string): Promise<boolean> {
  const labels = await issue.labels();
  return labels.nodes.some(l => l.name.toLowerCase() === name.toLowerCase());
}

// 12) Fetch the issue's state name safely (each call is a small extra request).
async function issueStateName(issue: Issue): Promise<string> {
  try {
    const s = await issue.state;
    return s?.name ?? "(No State)";
  } catch {
    return "(No State)";
  }
}

// 13) Convert N days → ISO timestamp for filtering.
function isoSinceDays(days: number): string | undefined {
  if (!days || Number.isNaN(days) || days <= 0) return undefined;
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

/* ------------------------------------------------------------
   Main program flow
------------------------------------------------------------- */

async function main() {
  // 14) Identify who the token belongs to.
  const viewer = await client.viewer;
  console.log(`Viewer: ${viewer.name} <${viewer.email}> (id: ${viewer.id})`);

  // 15) Determine whose issues to fetch:
  //     use provided email or fall back to viewer.id.
  let assigneeId: string | undefined = undefined;
  if (email) {
    const uid = await findUserIdByEmail(email);
    if (!uid) throw new Error(`No user found for email: ${email}`);
    assigneeId = uid;
  } else {
    assigneeId = viewer.id;
  }

  // 16) Compute ISO timestamp for "since" filter (if any).
  const sinceIso = isoSinceDays(sinceDays);

  // 17) Echo filters so we know what the query is doing.
  console.log(
    `\nFilters -> assignee: ${email ?? `${viewer.email} (viewer)`}` +
    (labelName ? `, label: "${labelName}"` : "") +
    (wantedState ? `, state: "${wantedState}"` : "") +
    (sinceIso ? `, since: ${sinceIso}` : "") +
    (includeArchived ? ", include archived" : "")
  );

  // 18) Initialize counters.
  const counts = new Map<string, number>();
  let totalFetched = 0;
  let totalMatched = 0;

  // 19) Paginate through all issues matching the assignee filter.
  let cursor: string | null | undefined = undefined;
  do {
    const page = await client.issues({
      first: 50,
      after: cursor ?? undefined,
      filter: {
        assignee: { id: { eq: assigneeId! } },             // server-side filter by assignee
        ...(includeArchived ? {} : { archivedAt: { null: true } }), // exclude archived unless requested
        ...(sinceIso ? { updatedAt: { gt: sinceIso } } : {}),       // updated since date
      },
    });

    // 20) For each issue, apply optional client-side refinements.
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

    // 24) Advance pagination cursor.
    cursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
  } while (cursor);

  /* ------------------------------------------------------------
     Output section
  ------------------------------------------------------------- */

  // 25) Sort states descending by count for nice output.
  const rows = [...counts.entries()].sort((a, b) => b[1] - a[1]);

  // 26) Determine column widths for pretty-printing.
  const maxStateLen = Math.max("State".length, ...rows.map(([s]) => s.length));
  const pad = (s: string, n: number) => s + " ".repeat(Math.max(0, n - s.length));

  // 27) Print header and separator.
  console.log("\nResults:");
  console.log(pad("State", maxStateLen), " | Count");
  console.log("-".repeat(maxStateLen), "-|------");

  // 28) Print each state row.
  for (const [state, count] of rows) {
    console.log(pad(state, maxStateLen), " | ", count.toString().padStart(5, " "));
  }

  // 29) Summary counts.
  console.log(`\nFetched: ${totalFetched}  Matched after filters: ${totalMatched}`);
}

// 30) Run main() and handle uncaught errors gracefully.
main().catch(err => {
  console.error(err);
  process.exit(1);
});

