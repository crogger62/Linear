/**
 * Customer Requests → CSV (CustomerRequests.csv)
 * ---------------------------------------------------------------
 * Scope selection:
 *   --project "<name>"     or  --project-id <uuid>
 *   --issue   TEAM-123     or  --issue-id <uuid>
 *   (no args) → whole workspace
 *
 * Output:
 *   CustomerRequests.csv with columns:
 *   project,issue,issue_title,request_id,customer,priority,source,reference_project,reference_issue,request
 */

import { LinearClient, Issue, Project } from "@linear/sdk";
import "dotenv/config";

/* ----------------------------- CLI flags ----------------------------- */

function argValue(name: string) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const PROJECT_NAME = argValue("--project");
const PROJECT_ID   = argValue("--project-id");
const ISSUE_IDENT  = argValue("--issue");
const ISSUE_ID     = argValue("--issue-id");

/* --------------------------- Small utilities ------------------------- */

type Need = {
  id: string;
  body?: string | null;
  priority?: number | null;
  customer?: {
    id: string;
    name?: string | null;
    revenue?: string | null;
    size?: string | null;
  } | null;
  attachment?: { url?: string | null } | null;
  // Optional references on the Need itself (leave blank if schema/workspace doesn't populate them)
  project?: { id: string; name?: string | null } | null;
  issue?: { id: string; identifier?: string | null; title?: string | null } | null;
};

type Row = {
  project: string;          // hosting issue's project
  issue: string;            // hosting issue's identifier (e.g., ENG-123)
  issueTitle: string;
  requestId: string;
  customer: string;
  customerRevenue: string;
  customerSize: string;
  priority: string;
  source: string;
  referenceProject: string; // need.project?.name (if present)
  referenceIssue: string;   // need.issue?.identifier (if present)
  request: string;          // ALWAYS quoted in CSV
};

function normalizePriority(p?: number | null): string {
  if (p === 1) return "Important";
  if (p === 0) return "Normal";
  return p == null ? "Unspecified" : String(p);
}

/** Escape and ALWAYS wrap in double quotes for the Request field. */
function csvForceQuotes(s: string | null | undefined): string {
  const v = String(s ?? "").replace(/"/g, '""'); // escape embedded quotes
  return `"${v}"`;
}

/** Standard CSV escaping (quotes only when needed) for other fields. */
function csvEscape(s: string | null | undefined): string {
  if (s == null) return "";
  const v = String(s).replace(/"/g, '""');
  return /[",\n\r]/.test(v) ? `"${v}"` : v;
}

async function paginate<T>(
  fetch: (after?: string | null) => Promise<{ nodes: T[]; pageInfo: { hasNextPage: boolean; endCursor?: string | null } }>
): Promise<T[]> {
  const out: T[] = [];
  let after: string | null | undefined = null;
  do {
    const page = await fetch(after);
    out.push(...page.nodes);
    after = page.pageInfo.hasNextPage ? (page.pageInfo.endCursor ?? null) : null;
  } while (after);
  return out;
}

/* -------------------------- Raw GQL helper --------------------------- */
/** Pull current needs for an Issue; include optional references to project/issue if available. */
const ISSUE_NEEDS_QUERY = /* GraphQL */ `
  query IssueNeeds($issueId: String!, $first: Int!, $after: String) {
    issue(id: $issueId) {
      id
      identifier
      title
      project { id name }
      needs(first: $first, after: $after) {
        nodes {
          id
          body
          priority
          attachment { url }
          customer { id name revenue size }
          project { id name }          # reference project (if present)
          issue { id identifier title }# reference issue   (if present)
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
`;

/* --------------------------------- Main --------------------------------- */

(async () => {
  const apiKey = process.env.LINEAR_API_KEY;
  if (!apiKey) {
    console.error("Missing LINEAR_API_KEY in .env");
    process.exit(1);
  }
  const client = new LinearClient({ apiKey });
  const gql = client.client;

  // 1) Build the issue selection
  let issues: Issue[] = [];

  if (ISSUE_ID || ISSUE_IDENT) {
    if (ISSUE_ID) {
      const one = await client.issue(ISSUE_ID);
      if (!one?.id) { console.error(`Issue id not found: ${ISSUE_ID}`); process.exit(1); }
      issues = [one];
    } else if (ISSUE_IDENT) {
      const m = ISSUE_IDENT.match(/^([A-Za-z]+)-(\d+)$/);
      if (!m) { console.error(`Invalid issue identifier: ${ISSUE_IDENT}. Expected TEAMKEY-123`); process.exit(1); }
      const teamKey = m[1].toUpperCase();
      const issueNumber = parseInt(m[2], 10);
      const matched = await paginate<Issue>((after) =>
        client.issues({
          first: 50,
          after,
          filter: { number: { eq: issueNumber }, team: { key: { eq: teamKey } } },
        })
      );
      if (matched.length === 0) {
        console.error(`No issue found for ${ISSUE_IDENT} (team ${teamKey}, number ${issueNumber})`);
        process.exit(1);
      }
      issues = matched;
    }
  } else if (PROJECT_ID || PROJECT_NAME) {
    let resolvedProjectId = PROJECT_ID;
    if (!resolvedProjectId && PROJECT_NAME) {
      const projects = await paginate<Project>((after) =>
        client.projects({ first: 50, after, filter: { name: { eq: PROJECT_NAME } } })
      );
      if (projects.length === 0) { console.error(`Project not found: ${PROJECT_NAME}`); process.exit(1); }
      resolvedProjectId = projects[0].id;
    }
    issues = await paginate<Issue>((after) =>
      client.issues({
        first: 50,
        after,
        filter: { project: { id: { eq: resolvedProjectId! } } },
      })
    );
  } else {
    issues = await paginate<Issue>((after) => client.issues({ first: 50, after }));
  }

  if (issues.length === 0) {
    console.log("No matching issues.");
    return;
  }

  // 2) Gather rows
  const rows: Row[] = [];
  for (const issue of issues) {
    const issueIdentifier = issue.identifier;
    const issueTitle = (await issue.title) ?? "";
    const projName = (await (await issue.project)?.name) ?? "(No Project)";

    let after: string | null | undefined = null;
    do {
      const resp = await gql.rawRequest(ISSUE_NEEDS_QUERY, { issueId: issue.id, first: 50, after });
      const data = resp.data as any;
      const edge = data?.issue?.needs;
      if (!edge) break;

      for (const n of edge.nodes as Need[]) {
        rows.push({
          project: projName,
          issue: issueIdentifier,
          issueTitle,
          requestId: n.id,
          customer: n.customer?.name ?? "",
          customerRevenue: n.customer?.revenue ?? "",
          customerSize: n.customer?.size ?? "",
          priority: normalizePriority(n.priority),
          source: n.attachment?.url ?? "",
          referenceProject: n.project?.name ?? "",
          referenceIssue: n.issue?.identifier ?? "",
          request: (n.body ?? "").trim(),
        });
      }

      after = edge.pageInfo?.hasNextPage ? (edge.pageInfo.endCursor ?? null) : null;
    } while (after);
  }

  if (rows.length === 0) {
    console.log("No customer requests found for the selected scope.");
    return;
  }

  // 3) Write CSV to fixed filename
  const header = [
    "project",
    "issue",
    "issue_title",
    "request_id",
    "customer",
    "customer_revenue",
    "customer_size",
    "priority",
    "source",
    "reference_project",
    "reference_issue",
    "request",
  ].join(",");

  const lines = [header];
  for (const r of rows) {
    lines.push([
      csvEscape(r.project),
      csvEscape(r.issue),
      csvEscape(r.issueTitle),
      csvEscape(r.requestId),
      csvEscape(r.customer),
      csvEscape(r.customerRevenue),
      csvEscape(r.customerSize),
      csvEscape(r.priority),
      csvEscape(r.source),
      csvEscape(r.referenceProject),
      csvEscape(r.referenceIssue),
      csvForceQuotes(r.request), // ALWAYS in double quotes
    ].join(","));
    console.log(
      r.project,
      r.issue,
      r.issueTitle,
      r.requestId,
      r.customer,
      r.customerRevenue,
      r.customerSize,
      r.priority,
      r.source,
      r.referenceProject,
      r.referenceProject
    ); 
  }

  const fs = await import("node:fs/promises");
  const file = "CustomerRequests.csv";
  await fs.writeFile(file, lines.join("\n"), "utf8");
  console.error(`Wrote ${file} (${Buffer.byteLength(lines.join("\n"), "utf8")} bytes)`);
})().catch((err) => {
  console.error("Failed:", err && (err.stack || err));
  process.exit(1);
});
