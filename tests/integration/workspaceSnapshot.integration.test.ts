import { describe, expect, it } from "vitest";
import { Project } from "@linear/sdk";
import {
  IssueLite,
  buildCsv,
  buildMarkdown,
  computeActiveProjects,
  computeAssigneeLoad,
  groupIssuesByProjectThenState,
} from "../../src/workspaceSnapshot-utils";

describe("workspaceSnapshot integration", () => {
  it("builds markdown and csv output from grouped data", () => {
    const issues: IssueLite[] = [
      {
        id: "1",
        identifier: "ALPHA-1",
        title: "Login, flow | step",
        stateName: "In Progress",
        projectId: "p1",
        projectName: "Alpha",
        teamName: "Core",
        assigneeId: "u1",
        assigneeName: "Ann",
      },
      {
        id: "2",
        identifier: "ALPHA-2",
        title: "Signup",
        stateName: "Todo",
        projectId: "p1",
        projectName: "Alpha",
        teamName: "Core",
        assigneeId: null,
        assigneeName: null,
      },
    ];

    const projects = {
      p1: { id: "p1", name: "Alpha", state: "planned", archivedAt: null } as Project,
    };

    const grouped = groupIssuesByProjectThenState(issues);
    const activeProjects = computeActiveProjects(issues, projects);
    const assigneeLoad = computeAssigneeLoad(issues);

    const markdown = buildMarkdown(grouped, activeProjects, assigneeLoad, {
      includeTeam: true,
      generatedAt: "2026-02-09T00:00:00.000Z",
    });

    expect(markdown).toContain("# Linear Workspace Snapshot");
    expect(markdown).toContain("_Generated: 2026-02-09T00:00:00.000Z_");
    expect(markdown).toContain("| Identifier | Title | Assignee | Team |");
    expect(markdown).toContain("| ALPHA-1 | Login, flow \\| step | Ann | Core |");
    expect(markdown).toContain("| Alpha | planned | 2 |");

    const csv = buildCsv(grouped, activeProjects, assigneeLoad, { includeTeam: true });
    expect(csv).toContain("section,project,state,identifier,title,assignee,team");
    expect(csv).toContain('issues_by_project_state,Alpha,In Progress,ALPHA-1,"Login, flow | step",Ann,Core');
    expect(csv).toContain("section,project,project_id,state,open_issues");
    expect(csv).toContain("section,assignee,open_issues");
  });
});
