import { describe, expect, it } from "vitest";
import type { Project } from "@linear/sdk";
import {
  buildCsv,
  buildMarkdown,
  computeActiveProjects,
  computeAssigneeLoad,
  csvEscape,
  escapeMd,
  groupIssuesByProjectThenState,
  mapLimit,
  paginate,
  type IssueLite,
} from "../workspaceSnapshot";

describe("workspaceSnapshot helpers (unit)", () => {
  it("csvEscape handles quotes, commas, and nulls", () => {
    expect(csvEscape("simple")).toBe("simple");
    expect(csvEscape("with,comma")).toBe('"with,comma"');
    expect(csvEscape('with "quote"')).toBe('"with ""quote"""');
    expect(csvEscape("multi\nline")).toBe('"multi\nline"');
    expect(csvEscape(null)).toBe("");
  });

  it("escapeMd escapes pipes and handles empty input", () => {
    expect(escapeMd("a|b|c")).toBe("a\\|b\\|c");
    expect(escapeMd(undefined)).toBe("");
  });

  it("paginate collects all pages in order", async () => {
    const fetch = async (after?: string | null) => {
      if (!after) {
        return { nodes: [1, 2], pageInfo: { hasNextPage: true, endCursor: "next" } };
      }
      return { nodes: [3], pageInfo: { hasNextPage: false, endCursor: null } };
    };
    const results = await paginate(fetch);
    expect(results).toEqual([1, 2, 3]);
  });

  it("mapLimit respects concurrency and preserves order", async () => {
    const items = [1, 2, 3, 4];
    let active = 0;
    let maxActive = 0;

    const results = await mapLimit(items, 2, async (item) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return item * 2;
    });

    expect(results).toEqual([2, 4, 6, 8]);
    expect(maxActive).toBeLessThanOrEqual(2);
  });

  it("groupIssuesByProjectThenState buckets missing project/state", () => {
    const issues: IssueLite[] = [
      {
        id: "1",
        identifier: "ABC-1",
        title: "One",
        stateName: "Todo",
        projectName: "Project A",
      },
      {
        id: "2",
        identifier: "ABC-2",
        title: "Two",
        stateName: "",
        projectName: "Project A",
      },
      {
        id: "3",
        identifier: "XYZ-1",
        title: "Three",
        stateName: "In Progress",
        projectName: null,
      },
    ];

    const grouped = groupIssuesByProjectThenState(issues);
    expect(grouped.has("Project A")).toBe(true);
    expect(grouped.has("(No Project)")).toBe(true);
    expect(grouped.get("Project A")?.get("Todo")?.length).toBe(1);
    expect(grouped.get("Project A")?.get("(No State)")?.length).toBe(1);
  });

  it("computeActiveProjects includes only planned/started non-archived projects", () => {
    const issues: IssueLite[] = [
      { id: "1", identifier: "ABC-1", title: "One", stateName: "Todo", projectId: "p1" },
      { id: "2", identifier: "ABC-2", title: "Two", stateName: "Todo", projectId: "p1" },
      { id: "3", identifier: "ABC-3", title: "Three", stateName: "Todo", projectId: "p2" },
    ];

    const projects = {
      p1: { id: "p1", name: "Alpha", state: "planned", archivedAt: null },
      p2: { id: "p2", name: "Beta", state: "completed", archivedAt: null },
      p3: { id: "p3", name: "Gamma", state: "started", archivedAt: "2024-01-01" },
    } as Record<string, Project>;

    const rows = computeActiveProjects(issues, projects);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      projectName: "Alpha",
      projectId: "p1",
      state: "planned",
      openCount: 2,
    });
  });

  it("computeAssigneeLoad aggregates and sorts by count", () => {
    const issues: IssueLite[] = [
      { id: "1", identifier: "A-1", title: "One", stateName: "Todo", assigneeId: "u1", assigneeName: "Ada" },
      { id: "2", identifier: "A-2", title: "Two", stateName: "Todo", assigneeId: "u1", assigneeName: "Ada" },
      { id: "3", identifier: "A-3", title: "Three", stateName: "Todo", assigneeId: "u2", assigneeName: "Ben" },
      { id: "4", identifier: "A-4", title: "Four", stateName: "Todo" },
    ];

    const rows = computeAssigneeLoad(issues);
    expect(rows[0]).toEqual({ name: "Ada", count: 2 });
    expect(rows.find((r) => r.name === "(unassigned)")?.count).toBe(1);
  });

  it("buildMarkdown renders headers, rows, and team column", () => {
    const grouped = new Map<string, Map<string, IssueLite[]>>([
      [
        "Project A",
        new Map([
          [
            "Todo",
            [
              {
                id: "1",
                identifier: "ABC-1",
                title: "Fix login",
                stateName: "Todo",
                assigneeName: "Alice",
                teamName: "Core",
              },
            ],
          ],
        ]),
      ],
    ]);

    const markdown = buildMarkdown(
      grouped,
      [{ projectName: "Project A", projectId: "p1", state: "planned", openCount: 1 }],
      [{ name: "Alice", count: 1 }],
      { includeTeam: true, generatedAt: "2026-02-11T00:00:00.000Z" }
    );

    expect(markdown).toContain("_Generated: 2026-02-11T00:00:00.000Z_");
    expect(markdown).toContain("| Identifier | Title | Assignee | Team |");
    expect(markdown).toContain("| ABC-1 | Fix login | Alice | Core |");
  });

  it("buildCsv renders sections with optional team column", () => {
    const grouped = new Map<string, Map<string, IssueLite[]>>([
      [
        "Project A",
        new Map([
          [
            "Todo",
            [
              {
                id: "1",
                identifier: "ABC-1",
                title: "Fix login",
                stateName: "Todo",
                assigneeName: "Alice",
                teamName: "Core",
              },
            ],
          ],
        ]),
      ],
    ]);

    const csv = buildCsv(
      grouped,
      [{ projectName: "Project A", projectId: "p1", state: "planned", openCount: 1 }],
      [{ name: "Alice", count: 1 }],
      { includeTeam: true }
    );

    expect(csv).toContain("section,project,state,identifier,title,assignee,team");
    expect(csv).toContain("issues_by_project_state,Project A,Todo,ABC-1,Fix login,Alice,Core");
    expect(csv).toContain("section,project,project_id,state,open_issues");
    expect(csv).toContain("section,assignee,open_issues");
  });
});
