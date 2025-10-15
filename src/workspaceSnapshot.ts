/**
 * Linear Workspace Snapshot CLI (TS-version friendly)
 * ---------------------------------------------------
 * Sections:
 *  1) Open issues grouped by Project → State
 *  2) Active projects (planned/started) with open-issue counts
 *  3) Assignee load (open issues per user)
 *
 * Flags:
 *  --format md|csv     (default md)
 *  --out <pathPrefix>  (writes <pathPrefix>.md/.csv; otherwise stdout)
 *  --include-team      (adds a Team column to the issues tables)
 */

import { LinearClient, Issue, Project /*, Team, User, WorkflowState*/ } from "@linear/sdk";
import "dotenv/config";

/* ----------------------------- CLI parse utils ---------------------------- */

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}
function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const FORMAT = (argValue("--format") ?? "md").toLowerCase(); // "md" | "csv"
const OUT_PREFIX = argValue("--out"); // optional
const INCLUDE_TEAM = hasFlag("--include-team");

/* --------------------------------- Types ---------------------------------- */

type IssueLite = {
  id: string;
  identifier: string;
  title: string;
  stateName: string;
  stateType?: string | null;
  projectId?: string | null;
  projectName?: string | null;
  teamName?: string | null;
  assigneeId?: string | null;
  assigneeName?: string | null;
};

/* -------------------------------- Helpers --------------------------------- */

// Simple CSV escape (quotes, commas, newlines)
function csvEscape(s: string | null | undefined): string {
  if (s == null) return "";
  const v = String(s).replace(/"/g, '""');
  return /[",\n\r]/.test(v) ? `"${v}"` : v;
}

// Simple markdown escape (only pipes, for tables)
function escapeMd(s: string | null | undefined): string {
  return (s ?? "").replace(/\|/g, "\\|");
}

function nowISO(): string {  // YYYY-MM-DDTHH:mm:ss.sssZ
  return new Date().toISOString();
}

/** Generic paginator for Linear SDK connections */
// helpful for iterating 
async function paginate<T>(
  fetch: (after?: string | null) => Promise<{
    nodes: T[];
    pageInfo: { hasNextPage: boolean; endCursor?: string | null };
  }>
): Promise<T[]> {
  const out: T[] = [];   // initialize
  let after: string | null | undefined = null;
  do {
    const page = await fetch(after);
    out.push(...page.nodes);
    after = page.pageInfo.hasNextPage ? (page.pageInfo.endCursor ?? null) : null;
  } while (after);
  return out;
}



/** Concurrency-limited mapper (safer than blasting all awaits at once) */
// From: https://stackoverflow.com/a/72205185/62937
// helps throttles API usage: it runs at most N concurrent tasks (limit), starting a new one only after another finishes.
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, idx: number) => Promise<R>
): Promise<R[]> {
  const result: R[] = new Array(items.length);
  let i = 0;
  let active = 0;
  return await new Promise<R[]>((resolve, reject) => {
    const pump = () => {
      if (i >= items.length && active === 0) return resolve(result);
      while (active < limit && i < items.length) {
        const idx = i++;
        active++;
        worker(items[idx], idx)
          .then((val) => {
            result[idx] = val;
            active--;
            pump();
          })
          .catch(reject);
      }
    };
    pump();
  });
}

/* ---------------------------- Data collection ----------------------------- */

/**
 * Fetch all OPEN issues:
 *   completedAt == null, canceledAt == null, archivedAt == null
 * Then update related fields (state, project, team, assignee) with capped concurrency.
 */
async function fetchOpenIssues(client: LinearClient): Promise<IssueLite[]> {
  const rawIssues = await paginate<Issue>((after) =>
    client.issues({
      first: 50,
      after,
      filter: { completedAt: { null: true }, canceledAt: { null: true }, archivedAt: { null: true } },
    })
  );

  const CONCURRENCY = 10;   // how many related entities to fetch at once

  /* lites - runs an async “map” over an array but only allows a fixed number of tasks (e.g. CONCURRENCY=10) to run at once.
   * When one task finishes, it immediately starts the next, keeping that concurrency limit constant.
   * It returns a promise that resolves to all results once every item has been processed.
   */
  const lites = await mapLimit(rawIssues, CONCURRENCY, async (issue) => {
    // Name the promises first to avoid quirky tuple inference in older TS
    const pState = issue.state;
    const pProject = issue.project;
    const pTeam = issue.team;
    const pAssignee = issue.assignee;

    const [state, project, team, assignee] = await Promise.all([
      pState,
      pProject,
      pTeam,
      pAssignee,
    ]);

    const lite: IssueLite = {
      id: issue.id,
      identifier: issue.identifier,
      title: issue.title ?? "",
      stateName: (state && (state as any).name) ?? "",
      stateType: (state && (state as any).type) ?? null,
      projectId: (project && (project as any).id) ?? null,
      projectName: (project && (project as any).name) ?? null,
      teamName: (team && (team as any).name) ?? null,
      assigneeId: (assignee && (assignee as any).id) ?? null,
      assigneeName: (assignee && (assignee as any).name) ?? null,
    };
    return lite;
  });

  return lites;
}

/** Fetch a map of projectId -> Project for the referenced set of IDs */
async function fetchProjectsById(client: LinearClient, projectIds: string[]): Promise<Record<string, Project>> {
  const uniq = Array.from(new Set(projectIds.filter(Boolean)));
  const out: Record<string, Project> = {};
  await Promise.all(
    uniq.map(async (pid) => {
      const p = await client.project(pid);
      out[pid] = p;
    })
  );
  return out;
}

/** Active = planned|started and not archived */
function isActiveProject(p?: Project | null): boolean {
  if (!p) return false;
  const state = String(p.state ?? "").toLowerCase();
  const active = state === "planned" || state === "started";
  return active && !p.archivedAt;
}

/* ------------------------------- Aggregation ------------------------------ */

function groupIssuesByProjectThenState(issues: IssueLite[]) {
  const grouped = new Map<string, Map<string, IssueLite[]>>();
  for (const iss of issues) {
    const proj = iss.projectName ?? "(No Project)";
    if (!grouped.has(proj)) grouped.set(proj, new Map());
    const byState = grouped.get(proj)!;

    const s = iss.stateName || "(No State)";
    if (!byState.has(s)) byState.set(s, []);
    byState.get(s)!.push(iss);
  }
  return grouped;
}

function computeActiveProjects(issues: IssueLite[], projects: Record<string, Project>) {
  const rows: Array<{ projectName: string; projectId: string; state: string; openCount: number }> = [];
  const referenced = Array.from(new Set(issues.map((i) => i.projectId).filter(Boolean)) as Set<string>);
  for (const pid of referenced) {
    const p = projects[pid!];
    if (!p) continue;
    if (!isActiveProject(p)) continue;
    rows.push({
      projectName: p.name ?? "(Unnamed Project)",
      projectId: pid!,
      state: p.state ?? "",
      openCount: issues.filter((i) => i.projectId === pid).length,
    });
  }
  rows.sort((a, b) => b.openCount - a.openCount || a.projectName.localeCompare(b.projectName));
  return rows;
}

function computeAssigneeLoad(issues: IssueLite[]) {
  const by = new Map<string, { name: string; count: number }>();
  for (const iss of issues) {
    const key = iss.assigneeId ?? "(unassigned)";
    const nm = iss.assigneeName ?? "(unassigned)";
    const cur = by.get(key) ?? { name: nm, count: 0 };
    cur.count += 1;
    by.set(key, cur);
  }
  return Array.from(by.values()).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/* -------------------------------- Rendering ------------------------------- */

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

async function renderMarkdown(
  byProjectThenState: Map<string, Map<string, IssueLite[]>>,
  activeProjects: Array<{ projectName: string; projectId: string; state: string; openCount: number }>,
  assigneeLoad: Array<{ name: string; count: number }>
) {
  const ts = nowISO();
  const lines: string[] = [];
  lines.push(`# Linear Workspace Snapshot`);
  lines.push(`_Generated: ${ts}_\n`);

  lines.push(`## Open Issues by Project & State`);
  for (const [projectName, byState] of byProjectThenState) {
    lines.push(`\n### ${escapeMd(projectName)}`);
    for (const [stateName, items] of byState) {
      lines.push(`\n**${escapeMd(stateName)}** (${items.length})`);
      lines.push(`\n| Identifier | Title | Assignee${INCLUDE_TEAM ? " | Team" : ""} |`);
      lines.push(`|---|---|---${INCLUDE_TEAM ? "|---" : ""}|`);
      for (const it of items) {
        lines.push(
          `| ${escapeMd(it.identifier)} | ${escapeMd(it.title)} | ${escapeMd(it.assigneeName ?? "(unassigned)")}${
            INCLUDE_TEAM ? ` | ${escapeMd(it.teamName ?? "")}` : ""
          } |`
        );
      }
    }
  }

  lines.push(`\n## Active Projects (planned/started)`);
  lines.push(`\n| Project | State | Open Issues |`);
  lines.push(`|---|---|---:|`);
  for (const p of activeProjects) {
    lines.push(`| ${escapeMd(p.projectName)} | ${escapeMd(p.state)} | ${p.openCount} |`);
  }

  lines.push(`\n## Assignee Load (open issues)`);
  lines.push(`\n| Assignee | Open Issues |`);
  lines.push(`|---|---:|`);
  for (const a of assigneeLoad) {
    lines.push(`| ${escapeMd(a.name)} | ${a.count} |`);
  }

  await writeOut(lines.join("\n"), "md");
}

async function renderCsv(
  byProjectThenState: Map<string, Map<string, IssueLite[]>>,
  activeProjects: Array<{ projectName: string; projectId: string; state: string; openCount: number }>,
  assigneeLoad: Array<{ name: string; count: number }>
) {
  const parts: string[] = [];
  parts.push("section,project,state,identifier,title,assignee" + (INCLUDE_TEAM ? ",team" : ""));
  for (const [projectName, byState] of byProjectThenState) {
    for (const [stateName, items] of byState) {
      for (const it of items) {
        parts.push(
          [
            "issues_by_project_state",
            csvEscape(projectName),
            csvEscape(stateName),
            csvEscape(it.identifier),
            csvEscape(it.title),
            csvEscape(it.assigneeName ?? "(unassigned)"),
            ...(INCLUDE_TEAM ? [csvEscape(it.teamName ?? "")] : []),
          ].join(",")
        );
      }
    }
  }

  parts.push("\nsection,project,project_id,state,open_issues");
  for (const p of activeProjects) {
    parts.push(["active_projects", csvEscape(p.projectName), csvEscape(p.projectId), csvEscape(p.state), String(p.openCount)].join(","));
  }

  parts.push("\nsection,assignee,open_issues");
  for (const a of assigneeLoad) {
    parts.push(["assignee_load", csvEscape(a.name), String(a.count)].join(","));
  }

  await writeOut(parts.join("\n"), "csv");
}

/* ---------------------------------- Main ---------------------------------- */

(async () => {
  const apiKey = process.env.LINEAR_API_KEY;
  if (!apiKey) {
    console.error("Missing LINEAR_API_KEY in environment (.env).");
    process.exit(1);
  }
  const client = new LinearClient({ apiKey });

  const openIssues = await fetchOpenIssues(client);
  const projectIds = openIssues.map((i) => i.projectId).filter((x): x is string => Boolean(x));
  const projectsById = await fetchProjectsById(client, projectIds);

  const grouped = groupIssuesByProjectThenState(openIssues);
  const activeProjects = computeActiveProjects(openIssues, projectsById);
  const assigneeLoad = computeAssigneeLoad(openIssues);

  if (FORMAT === "csv") {
    await renderCsv(grouped, activeProjects, assigneeLoad);
  } else {
    await renderMarkdown(grouped, activeProjects, assigneeLoad);
  }
})().catch((err) => {
  console.error("Snapshot failed:", err && (err.stack || err));
  process.exit(1);
});
