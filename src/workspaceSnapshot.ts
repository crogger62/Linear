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
import {
  ActiveProjectRow,
  AssigneeLoadRow,
  IssueLite,
  buildCsv,
  buildMarkdown,
  computeActiveProjects,
  computeAssigneeLoad,
  groupIssuesByProjectThenState,
  mapLimit,
  paginate,
} from "./workspaceSnapshot-utils";

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

/* ---------------------------- Data collection ----------------------------- */

/**
 * Fetch all OPEN issues:
 *   completedAt == null, canceledAt == null, archivedAt == null (filtered after fetch)
 * Then update related fields (state, project, team, assignee) with capped concurrency.
 */
async function fetchOpenIssues(client: LinearClient): Promise<IssueLite[]> {
  const rawIssues = await paginate<Issue>((after) =>
    client.issues({
      first: 50,
      after,
      filter: { completedAt: { null: true }, canceledAt: { null: true } },
    })
  );

  // Filter out archived issues (archivedAt is not available in IssueFilter type, so we filter after fetching)
  const openIssues = rawIssues.filter(issue => !issue.archivedAt);

  const CONCURRENCY = 10;   // how many related entities to fetch at once

  /* lites - runs an async “map” over an array but only allows a fixed number of tasks (e.g. CONCURRENCY=10) to run at once.
   * When one task finishes, it immediately starts the next, keeping that concurrency limit constant.
   * It returns a promise that resolves to all results once every item has been processed.
   */
  const lites = await mapLimit(openIssues, CONCURRENCY, async (issue) => {
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
  activeProjects: ActiveProjectRow[],
  assigneeLoad: AssigneeLoadRow[]
) {
  const content = buildMarkdown(byProjectThenState, activeProjects, assigneeLoad, {
    includeTeam: INCLUDE_TEAM,
  });
  await writeOut(content, "md");
}

async function renderCsv(
  byProjectThenState: Map<string, Map<string, IssueLite[]>>,
  activeProjects: ActiveProjectRow[],
  assigneeLoad: AssigneeLoadRow[]
) {
  const content = buildCsv(byProjectThenState, activeProjects, assigneeLoad, { includeTeam: INCLUDE_TEAM });
  await writeOut(content, "csv");
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
