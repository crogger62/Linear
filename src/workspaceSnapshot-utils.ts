import { Project } from "@linear/sdk";

export type IssueLite = {
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

export type ActiveProjectRow = {
  projectName: string;
  projectId: string;
  state: string;
  openCount: number;
};

export type AssigneeLoadRow = {
  name: string;
  count: number;
};

type BuildOptions = {
  includeTeam?: boolean;
  generatedAt?: string;
};

// Simple CSV escape (quotes, commas, newlines)
export function csvEscape(s: string | null | undefined): string {
  if (s == null) return "";
  const v = String(s).replace(/"/g, '""');
  return /[",\n\r]/.test(v) ? `"${v}"` : v;
}

// Simple markdown escape (only pipes, for tables)
export function escapeMd(s: string | null | undefined): string {
  return (s ?? "").replace(/\|/g, "\\|");
}

export function nowISO(): string {
  return new Date().toISOString();
}

/** Generic paginator for Linear SDK connections */
export async function paginate<T>(
  fetch: (after?: string | null) => Promise<{
    nodes: T[];
    pageInfo: { hasNextPage: boolean; endCursor?: string | null };
  }>
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

/** Concurrency-limited mapper (safer than blasting all awaits at once) */
export async function mapLimit<T, R>(
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

/** Active = planned|started and not archived */
export function isActiveProject(p?: Project | null): boolean {
  if (!p) return false;
  const state = String(p.state ?? "").toLowerCase();
  const active = state === "planned" || state === "started";
  return active && !p.archivedAt;
}

export function groupIssuesByProjectThenState(issues: IssueLite[]) {
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

export function computeActiveProjects(issues: IssueLite[], projects: Record<string, Project>): ActiveProjectRow[] {
  const rows: ActiveProjectRow[] = [];
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

export function computeAssigneeLoad(issues: IssueLite[]): AssigneeLoadRow[] {
  const by = new Map<string, AssigneeLoadRow>();
  for (const iss of issues) {
    const key = iss.assigneeId ?? "(unassigned)";
    const nm = iss.assigneeName ?? "(unassigned)";
    const cur = by.get(key) ?? { name: nm, count: 0 };
    cur.count += 1;
    by.set(key, cur);
  }
  return Array.from(by.values()).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

export function buildMarkdown(
  byProjectThenState: Map<string, Map<string, IssueLite[]>>,
  activeProjects: ActiveProjectRow[],
  assigneeLoad: AssigneeLoadRow[],
  options: BuildOptions = {}
): string {
  const includeTeam = options.includeTeam ?? false;
  const ts = options.generatedAt ?? nowISO();
  const lines: string[] = [];
  lines.push(`# Linear Workspace Snapshot`);
  lines.push(`_Generated: ${ts}_\n`);

  lines.push(`## Open Issues by Project & State`);
  for (const [projectName, byState] of byProjectThenState) {
    lines.push(`\n### ${escapeMd(projectName)}`);
    for (const [stateName, items] of byState) {
      lines.push(`\n**${escapeMd(stateName)}** (${items.length})`);
      lines.push(`\n| Identifier | Title | Assignee${includeTeam ? " | Team" : ""} |`);
      lines.push(`|---|---|---${includeTeam ? "|---" : ""}|`);
      for (const it of items) {
        lines.push(
          `| ${escapeMd(it.identifier)} | ${escapeMd(it.title)} | ${escapeMd(it.assigneeName ?? "(unassigned)")}${
            includeTeam ? ` | ${escapeMd(it.teamName ?? "")}` : ""
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

  return lines.join("\n");
}

export function buildCsv(
  byProjectThenState: Map<string, Map<string, IssueLite[]>>,
  activeProjects: ActiveProjectRow[],
  assigneeLoad: AssigneeLoadRow[],
  options: BuildOptions = {}
): string {
  const includeTeam = options.includeTeam ?? false;
  const parts: string[] = [];
  parts.push(`section,project,state,identifier,title,assignee${includeTeam ? ",team" : ""}`);
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
            ...(includeTeam ? [csvEscape(it.teamName ?? "")] : []),
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

  return parts.join("\n");
}
