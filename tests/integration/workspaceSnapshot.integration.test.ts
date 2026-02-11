import { describe, expect, it, vi } from "vitest";
import type { Issue, LinearClient, Project } from "@linear/sdk";
import {
  buildMarkdown,
  computeActiveProjects,
  computeAssigneeLoad,
  fetchOpenIssues,
  fetchProjectsById,
  groupIssuesByProjectThenState,
} from "../../src/workspaceSnapshot";

type IssueShape = Issue & {
  archivedAt?: string | null;
  state: Promise<{ name: string; type?: string | null } | null>;
  project: Promise<{ id: string; name?: string | null } | null>;
  team: Promise<{ name?: string | null } | null>;
  assignee: Promise<{ id?: string | null; name?: string | null } | null>;
};

const makeIssue = (overrides: Partial<IssueShape>): IssueShape => {
  return {
    id: "issue-1",
    identifier: "ENG-1",
    title: "First issue",
    archivedAt: null,
    state: Promise.resolve({ name: "Todo", type: "backlog" }),
    project: Promise.resolve({ id: "p1", name: "Project Alpha" }),
    team: Promise.resolve({ name: "Core" }),
    assignee: Promise.resolve({ id: "u1", name: "Ada" }),
    ...overrides,
  } as IssueShape;
};

describe("workspaceSnapshot pipeline (integration)", () => {
  it("fetches open issues, aggregates, and renders markdown", async () => {
    const issue1 = makeIssue({ id: "issue-1", identifier: "ENG-1", title: "First issue" });
    const issue2 = makeIssue({
      id: "issue-2",
      identifier: "ENG-2",
      title: "Archived issue",
      archivedAt: "2025-01-01",
    });
    const issue3 = makeIssue({
      id: "issue-3",
      identifier: "ENG-3",
      title: "Second issue",
      project: Promise.resolve({ id: "p2", name: "Project Beta" }),
      assignee: Promise.resolve({ id: "u2", name: "Ben" }),
      state: Promise.resolve({ name: "In Progress", type: "started" }),
    });

    const issuesMock = vi
      .fn()
      .mockResolvedValueOnce({
        nodes: [issue1, issue2],
        pageInfo: { hasNextPage: true, endCursor: "cursor-1" },
      })
      .mockResolvedValueOnce({
        nodes: [issue3],
        pageInfo: { hasNextPage: false, endCursor: null },
      });

    const projects: Record<string, Project> = {
      p1: { id: "p1", name: "Project Alpha", state: "planned", archivedAt: null } as Project,
      p2: { id: "p2", name: "Project Beta", state: "completed", archivedAt: null } as Project,
    };
    const projectMock = vi.fn(async (id: string) => projects[id]);

    const client = { issues: issuesMock, project: projectMock } as unknown as LinearClient;

    const openIssues = await fetchOpenIssues(client);
    expect(openIssues).toHaveLength(2);
    expect(openIssues.map((i) => i.identifier)).toEqual(["ENG-1", "ENG-3"]);
    expect(issuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        first: 50,
        filter: { completedAt: { null: true }, canceledAt: { null: true } },
      })
    );

    const projectIds = openIssues.map((i) => i.projectId).filter((x): x is string => Boolean(x));
    const projectsById = await fetchProjectsById(client, projectIds);
    expect(projectMock).toHaveBeenCalledTimes(2);
    expect(projectsById.p1?.name).toBe("Project Alpha");

    const grouped = groupIssuesByProjectThenState(openIssues);
    const activeProjects = computeActiveProjects(openIssues, projectsById);
    const assigneeLoad = computeAssigneeLoad(openIssues);
    const markdown = buildMarkdown(grouped, activeProjects, assigneeLoad, {
      includeTeam: true,
      generatedAt: "2026-02-11T00:00:00.000Z",
    });

    expect(markdown).toContain("## Open Issues by Project & State");
    expect(markdown).toContain("Project Alpha");
    expect(markdown).toContain("| Identifier | Title | Assignee | Team |");
    expect(markdown).toContain("## Active Projects (planned/started)");
    expect(markdown).toContain("Project Alpha");
    expect(markdown).toContain("## Assignee Load (open issues)");
  });
});
