/**
 * Customer Requests CLI (clean output: MD/CSV)
 * ---------------------------------------------------------------
 * Select a project OR an issue OR the whole workspace, then list all
 * current Customer Requests (CustomerNeed) attached to matching issues.
 *
 * Usage:
 *  npx ts-node src/customerRequests.ts
 *  npx ts-node src/customerRequests.ts --project "Website Revamp"
 *  npx ts-node src/customerRequests.ts --project-id <uuid>
 *  npx ts-node src/customerRequests.ts --issue ENG-123
 *  npx ts-node src/customerRequests.ts --issue-id <uuid>
 *  npx ts-node src/customerRequests.ts --format csv --out customer-requests
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
const FORMAT       = (argValue("--format") ?? "md").toLowerCase(); // "md" | "csv"
const OUT_PREFIX   = argValue("--out"); // optional file path prefix

/* ------------------------- Small utilities --------------------------- */

type Need = {
  id: string;
  body?: string | null;
  priority?: number | null; // often 0/1; treat others defensively
  customer?: { id: string; name?: string | null } | null;
  attachment?: { url?: string | null } | null;
};
type RequestRow = {
  project: string;
  issueId: string;       // issue identifier (e.g., ENG-123)
  issueTitle: string;
  requestId: string;
  customer: string;
  priority: string;
  source: string;        // URL or empty
  body: string;          // trimmed
};

function nowISO() { return new Date().toISOString(); }
function csvEscape(s: string | null | undefined): string {
  if (s == null) return "";
  const v = String(s).replace(/"/g, '""');
  return /[",\n\r]/.test(v) ? `"${v}"` : v;
}
function mdEscape(s: string | null | undefined): string {
  return (s ?? "").replace(/\|/g, "\\|");
}
function normalizePriority(p?: number | null): string {
  if (p === 1) return "Important";
  if (p === 0) return "Normal";
  return p == null ? "Unspecified" : String(p);
}
function trimBody(s?: string | null): string {
  const t = (s ?? "").trim();
  return t.length ? t : "(no body)";
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
/** Query current needs for an Issue by id (paginated). */
const ISSUE_NEEDS_QUERY = /* GraphQL */ `
  query IssueNeeds($issueId: String!, $first: Int!, $after: String) {
    issue(id: $issueId) {
      id
      identifier
      title
      needs(first: $first, after: $after) {
        nodes {
          id
          body
          priority
          attachment { url }
          customer { id name }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
`;

/* ------------------------------ Main -------------------------------- */

(async () => {
  const apiKey = process.env.LINEAR_API_KEY;
  if (!apiKey) {
    console.error("Missing LINEAR_API_KEY in .env");
    process.exit(1);
  }
  const client = new LinearClient({ apiKey });
  const gql = client.client; // underlying graphql-request client

  // 1) Select issues to inspect
  let issues: Issue[] = [];

  if (ISSUE_ID || ISSUE_IDENT) {
    if (ISSUE_ID) {
      const one = await client.issue(ISSUE_ID);
      if (!one?.id) { console.error(`Issue id not found: ${ISSUE_ID}`); process.exit(1); }
      issues = [one];
    } else if (ISSUE_IDENT) {
      const m = ISSUE_IDENT.match(/^([A-Za-z]+)-(\d+)$/);
      if (!m) {
        console.error(`Invalid issue identifier: ${ISSUE_IDENT}. Expected TEAMKEY-123`);
        process.exit(1);
      }
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
    // Project selection
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
        filter: {
          project: { id: { eq: resolvedProjectId! } },
          // Add “open-only” if desired:
          // completedAt: { null: true }, canceledAt: { null: true }, archivedAt: { null: true },
        },
      })
    );
  } else {
    // Workspace-wide
    issues = await paginate<Issue>((after) => client.issues({ first: 50, after }));
  }

  if (issues.length === 0) {
    console.log("No matching issues.");
    return;
  }

  // 2) Collect rows (clean structure for rendering)
  const rows: RequestRow[] = [];
  for (const issue of issues) {
    const identifier = issue.identifier;
    const title = (await issue.title) ?? "";
    const projectName = (await (await issue.project)?.name) ?? "(No Project)";

    // Fetch needs
    let after: string | null | undefined = null;
    do {
      const resp = await gql.rawRequest(ISSUE_NEEDS_QUERY, { issueId: issue.id, first: 50, after });
      const data = resp.data as any;
      const edge = data?.issue?.needs;
      if (!edge) break;

      for (const n of edge.nodes as Need[]) {
        rows.push({
          project: projectName,
          issueId: identifier,
          issueTitle: title,
          requestId: n.id,
          customer: n.customer?.name ?? "(none)",
          priority: normalizePriority(n.priority),
          source: n.attachment?.url ?? "",
          body: trimBody(n.body),
        });
      }

      after = edge.pageInfo?.hasNextPage ? (edge.pageInfo.endCursor ?? null) : null;
    } while (after);
  }

  if (rows.length === 0) {
    console.log("No customer requests found for the selected scope.");
    return;
  }

  // 3) Render
  if (FORMAT === "csv") {
    const parts: string[] = [];
    parts.push([
      "project",
      "issue",
      "issue_title",
      "request_id",
      "customer",
      "priority",
      "source",
      "body",
    ].join(","));
    for (const r of rows) {
      parts.push([
        csvEscape(r.project),
        csvEscape(r.issueId),
        csvEscape(r.issueTitle),
        csvEscape(r.requestId),
        csvEscape(r.customer),
        csvEscape(r.priority),
        csvEscape(r.source),
        csvEscape(r.body),
      ].join(","));
    }
    await writeOut(parts.join("\n"), "csv");
  } else {
    // Markdown
    const ts = nowISO();
    const lines: string[] = [];
    lines.push(`# Customer Requests Snapshot`);
    lines.push(`_Generated: ${ts}_\n`);

    // Group by issue for readable sections
    const byIssue = new Map<string, RequestRow[]>();
    for (const r of rows) {
      const key = `${r.issueId}|||${r.issueTitle}|||${r.project}`;
      if (!byIssue.has(key)) byIssue.set(key, []);
      byIssue.get(key)!.push(r);
    }

    for (const [key, list] of byIssue) {
      const [issueId, issueTitle, projectName] = key.split("|||");
      lines.push(`## ${mdEscape(issueId)} — ${mdEscape(issueTitle)}`);
      lines.push(`**Project:** ${mdEscape(projectName)}\n`);
      lines.push(`| Request ID | Customer | Priority | Source | Request |`);
      lines.push(`|---|---|---|---|---|`);
      for (const r of list) {
        lines.push([
          mdEscape(r.requestId),
          mdEscape(r.customer),
          mdEscape(r.priority),
          r.source ? `[link](${r.source})` : "",
          mdEscape(r.body),
        ].map((c) => ` ${c} `).join("|").replace(/^/, "|").concat("|"));
      }
      lines.push(""); // blank line between issues
    }

    await writeOut(lines.join("\n"), "md");
  }
})().catch((err) => {
  console.error("Failed:", err && (err.stack || err));
  process.exit(1);
});

/* ------------------------------ IO helper ---------------------------- */
async function writeOut(content: string, ext: "md" | "csv") {
  if (!OUT_PREFIX) {
    process.stdout.write(content + "\n");
    return;
  }
  const fs = await import("node:fs/promises");
  const file = `${OUT_PREFIX}.${ext}`;
  await fs.writeFile(file, content, "utf8");
  console.error(`Wrote ${file} (${Buffer.byteLength(content, "utf8")} bytes)`);
}

