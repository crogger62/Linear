/** SDK script that filters by assignee email, label name, and/or workflow state name, then prints counts by state. It uses server-side filtering for the assignee (reliable) and narrows label/state client-side to avoid schema gotchas. It also supports a --since <days> window and --include-archived.**/



import "dotenv/config";
import { LinearClient, Issue } from "@linear/sdk";
import fetch from "cross-fetch";
(globalThis as any).fetch ??= fetch;

const apiKey = process.env.LINEAR_API_KEY;
if (!apiKey) throw new Error("Missing LINEAR_API_KEY in .env");

const client = new LinearClient({ apiKey });

/** ---- args ---- */
function getArg(flag: string): string | undefined {
  const i = process.argv.indexOf(`--${flag}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function hasFlag(flag: string): boolean {
  return process.argv.includes(`--${flag}`);
}

const email = getArg("email");               // e.g. --email "jane@company.com"
const labelName = getArg("label");           // e.g. --label "Needs Triage"
const wantedState = getArg("state");         // e.g. --state "In Progress"
const sinceDays = Number(getArg("since") ?? "0"); // e.g. --since 7
const includeArchived = hasFlag("include-archived");

/** ---- helpers ---- */
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

async function issueHasLabelByName(issue: Issue, name: string): Promise<boolean> {
  const labels = await issue.labels();
  return labels.nodes.some(l => l.name.toLowerCase() === name.toLowerCase());
}

async function issueStateName(issue: Issue): Promise<string> {
  try {
    const s = await issue.state;
    return s?.name ?? "(No State)";
  } catch {
    return "(No State)";
  }
}

function isoSinceDays(days: number): string | undefined {
  if (!days || Number.isNaN(days) || days <= 0) return undefined;
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

/** ---- main ---- */
async function main() {
  const viewer = await client.viewer;
  console.log(`Viewer: ${viewer.name} <${viewer.email}> (id: ${viewer.id})`);

  let assigneeId: string | undefined = undefined;
  if (email) {
    const uid = await findUserIdByEmail(email);
    if (!uid) throw new Error(`No user found for email: ${email}`);
    assigneeId = uid;
  } else {
    assigneeId = viewer.id;
  }

  const sinceIso = isoSinceDays(sinceDays);

  console.log(
    `\nFilters -> assignee: ${email ?? `${viewer.email} (viewer)`}` +
    (labelName ? `, label: "${labelName}"` : "") +
    (wantedState ? `, state: "${wantedState}"` : "") +
    (sinceIso ? `, since: ${sinceIso}` : "") +
    (includeArchived ? ", include archived" : "")
  );

  const counts = new Map<string, number>();
  let totalFetched = 0;
  let totalMatched = 0;

  let cursor: string | null | undefined = undefined;
  do {
    const page = await client.issues({
      first: 50,
      after: cursor ?? undefined,
      filter: {
        assignee: { id: { eq: assigneeId! } },
        ...(includeArchived ? {} : { archivedAt: { null: true } }),
        ...(sinceIso ? { updatedAt: { gt: sinceIso } } : {}),
      },
    });

    for (const issue of page.nodes) {
      totalFetched += 1;

      // client-side refinements
      if (labelName) {
        const hasLabel = await issueHasLabelByName(issue, labelName);
        if (!hasLabel) continue;
      }
      if (wantedState) {
        const st = await issueStateName(issue);
        if (st.toLowerCase() !== wantedState.toLowerCase()) continue;
      }

      const stateName = await issueStateName(issue);
      counts.set(stateName, (counts.get(stateName) ?? 0) + 1);
      totalMatched += 1;
    }

    cursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
  } while (cursor);

  const rows = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const maxStateLen = Math.max("State".length, ...rows.map(([s]) => s.length));
  const pad = (s: string, n: number) => s + " ".repeat(Math.max(0, n - s.length));

  console.log("\nResults:");
  console.log(pad("State", maxStateLen), " | Count");
  console.log("-".repeat(maxStateLen), "-|------");
  for (const [state, count] of rows) {
    console.log(pad(state, maxStateLen), " | ", count.toString().padStart(5, " "));
  }
  console.log(`\nFetched: ${totalFetched}  Matched after filters: ${totalMatched}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

