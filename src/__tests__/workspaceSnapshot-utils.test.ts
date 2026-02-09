import { describe, expect, it } from "vitest";
import { Project } from "@linear/sdk";
import {
  IssueLite,
  computeActiveProjects,
  computeAssigneeLoad,
  csvEscape,
  escapeMd,
  groupIssuesByProjectThenState,
  isActiveProject,
  mapLimit,
  paginate,
} from "../workspaceSnapshot-utils";

describe("workspaceSnapshot utils", () => {
  describe("csvEscape", () => {
    it("returns empty string for nullish values", () => {
      expect(csvEscape(undefined)).toBe("");
      expect(csvEscape(null)).toBe("");
    });

    it("leaves safe strings untouched", () => {
      expect(csvEscape("alpha")).toBe("alpha");
      expect(csvEscape("123")).toBe("123");
    });

    it("quotes and escapes special characters", () => {
      expect(csvEscape('a,b')).toBe('"a,b"');
      expect(csvEscape('line1\nline2')).toBe('"line1\nline2"');
      expect(csvEscape('He said "hi"')).toBe('"He said ""hi"""');
    });
  });

  describe("escapeMd", () => {
    it("escapes pipe characters for tables", () => {
      expect(escapeMd("A|B|C")).toBe("A\\|B\\|C");
    });

    it("handles nullish values", () => {
      expect(escapeMd(undefined)).toBe("");
      expect(escapeMd(null)).toBe("");
    });
  });

  describe("isActiveProject", () => {
    it("returns true for planned/started and not archived", () => {
      const planned = { state: "planned", archivedAt: null } as Project;
      const started = { state: "Started", archivedAt: null } as Project;
      expect(isActiveProject(planned)).toBe(true);
      expect(isActiveProject(started)).toBe(true);
    });

    it("returns false for archived or inactive projects", () => {
      const archived = { state: "planned", archivedAt: "2024-01-01T00:00:00Z" } as Project;
      const completed = { state: "completed", archivedAt: null } as Project;
      expect(isActiveProject(archived)).toBe(false);
      expect(isActiveProject(completed)).toBe(false);
    });
  });

  describe("groupIssuesByProjectThenState", () => {
    it("groups issues by project and state with fallbacks", () => {
      const issues: IssueLite[] = [
        {
          id: "1",
          identifier: "ALPHA-1",
          title: "Alpha first",
          stateName: "Todo",
          projectId: "p1",
          projectName: "Alpha",
          assigneeId: "u1",
          assigneeName: "Ada",
        },
        {
          id: "2",
          identifier: "BETA-1",
          title: "Beta first",
          stateName: "",
          projectId: null,
          projectName: null,
          assigneeId: null,
          assigneeName: null,
        },
      ];

      const grouped = groupIssuesByProjectThenState(issues);
      expect(grouped.get("Alpha")?.get("Todo")?.length).toBe(1);
      expect(grouped.get("(No Project)")?.get("(No State)")?.length).toBe(1);
    });
  });

  describe("computeActiveProjects", () => {
    it("filters and sorts active projects by open issue count", () => {
      const issues: IssueLite[] = [
        {
          id: "1",
          identifier: "ALPHA-1",
          title: "Alpha first",
          stateName: "Todo",
          projectId: "p1",
          projectName: "Alpha",
          assigneeId: "u1",
          assigneeName: "Ada",
        },
        {
          id: "2",
          identifier: "ALPHA-2",
          title: "Alpha second",
          stateName: "In Progress",
          projectId: "p1",
          projectName: "Alpha",
          assigneeId: null,
          assigneeName: null,
        },
        {
          id: "3",
          identifier: "GAMMA-1",
          title: "Gamma first",
          stateName: "Todo",
          projectId: "p3",
          projectName: "Gamma",
          assigneeId: "u2",
          assigneeName: "Ben",
        },
      ];

      const projects = {
        p1: { id: "p1", name: "Alpha", state: "planned", archivedAt: null } as Project,
        p2: { id: "p2", name: "Beta", state: "completed", archivedAt: null } as Project,
        p3: { id: "p3", name: "Gamma", state: "started", archivedAt: "2024-01-01T00:00:00Z" } as Project,
      };

      const rows = computeActiveProjects(issues, projects);
      expect(rows).toHaveLength(1);
      expect(rows[0].projectId).toBe("p1");
      expect(rows[0].openCount).toBe(2);
    });
  });

  describe("computeAssigneeLoad", () => {
    it("groups by assignee and sorts by count then name", () => {
      const issues: IssueLite[] = [
        {
          id: "1",
          identifier: "A-1",
          title: "One",
          stateName: "Todo",
          projectId: "p1",
          projectName: "Alpha",
          assigneeId: "u1",
          assigneeName: "Ada",
        },
        {
          id: "2",
          identifier: "A-2",
          title: "Two",
          stateName: "Todo",
          projectId: "p1",
          projectName: "Alpha",
          assigneeId: null,
          assigneeName: null,
        },
        {
          id: "3",
          identifier: "A-3",
          title: "Three",
          stateName: "Todo",
          projectId: "p1",
          projectName: "Alpha",
          assigneeId: null,
          assigneeName: null,
        },
        {
          id: "4",
          identifier: "B-1",
          title: "Four",
          stateName: "Todo",
          projectId: "p2",
          projectName: "Beta",
          assigneeId: "u2",
          assigneeName: "Ben",
        },
      ];

      const rows = computeAssigneeLoad(issues);
      expect(rows[0]).toEqual({ name: "(unassigned)", count: 2 });
      expect(rows[1].name).toBe("Ada");
      expect(rows[2].name).toBe("Ben");
    });
  });

  describe("paginate", () => {
    it("accumulates pages until hasNextPage is false", async () => {
      const calls: Array<string | null | undefined> = [];
      const fetch = async (after?: string | null) => {
        calls.push(after);
        if (!after) {
          return { nodes: [1, 2], pageInfo: { hasNextPage: true, endCursor: "c1" } };
        }
        return { nodes: [3], pageInfo: { hasNextPage: false, endCursor: null } };
      };

      const results = await paginate(fetch);
      expect(results).toEqual([1, 2, 3]);
      expect(calls).toEqual([null, "c1"]);
    });
  });

  describe("mapLimit", () => {
    it("limits concurrency and preserves order", async () => {
      const items = [1, 2, 3, 4, 5];
      let active = 0;
      let maxActive = 0;

      const results = await mapLimit(items, 2, async (value) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        return value * 2;
      });

      expect(maxActive).toBeLessThanOrEqual(2);
      expect(results).toEqual([2, 4, 6, 8, 10]);
    });
  });
});
