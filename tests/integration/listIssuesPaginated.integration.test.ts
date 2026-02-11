import { describe, expect, it, vi } from "vitest";
import { listIssuesPaginated } from "../../src/listIssuesPaginated";

describe("listIssuesPaginated integration", () => {
  it("paginates, resolves relations, and logs expected output", async () => {
    const pages = [
      {
        nodes: [
          {
            id: "1",
            title: "Issue A",
            identifier: "TEAM-1",
            state: () => Promise.resolve({ name: "Backlog" }),
            assignee: Promise.resolve({ name: "Sam" }),
            project: { name: "Project A" },
          },
          {
            id: "2",
            title: null,
            identifier: "TEAM-2",
            state: null,
            assignee: undefined,
            project: Promise.resolve({ name: "Project B" }),
          },
        ],
        pageInfo: { hasNextPage: true, endCursor: "cursor-1" },
      },
      {
        nodes: [
          {
            id: "3",
            title: null,
            identifier: null,
            state: { name: "Done" },
            assignee: () => Promise.resolve({ name: "Lee" }),
            project: null,
          },
        ],
        pageInfo: { hasNextPage: false, endCursor: null },
      },
    ];

    const issues = vi
      .fn()
      .mockResolvedValueOnce(pages[0])
      .mockResolvedValueOnce(pages[1]);
    const client = { issues };
    const logs: string[] = [];
    const logger = { log: (message: string) => logs.push(message) };

    const total = await listIssuesPaginated(client, { pageSize: 2, logger });

    expect(total).toBe(3);
    expect(issues).toHaveBeenCalledTimes(2);
    expect(issues.mock.calls[0][0]).toEqual({ first: 2, after: undefined });
    expect(issues.mock.calls[1][0]).toEqual({ first: 2, after: "cursor-1" });
    expect(logs).toEqual([
      "Page 1 — 2 issues",
      "  - Issue A (id: 1) — [Backlog] — project: Project A — assignee: Sam",
      "  - TEAM-2 (id: 2) — project: Project B",
      "Page 2 — 1 issue",
      "  - <untitled> (id: 3) — [Done] — assignee: Lee",
      "\nTotal issues listed: 3",
    ]);
  });

  it("propagates client errors", async () => {
    const issues = vi.fn().mockRejectedValue(new Error("API unavailable"));
    const client = { issues };
    const logger = { log: vi.fn() };

    await expect(listIssuesPaginated(client, { logger })).rejects.toThrow("API unavailable");
    expect(issues).toHaveBeenCalledTimes(1);
  });
});
