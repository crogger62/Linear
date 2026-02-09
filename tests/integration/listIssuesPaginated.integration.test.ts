import { describe, expect, it, vi } from "vitest";
import { listIssuesPaginated, type IssueLike } from "../../src/listIssuesPaginated";

type LogCapture = { lines: string[]; logger: { log: (...args: unknown[]) => void } };

function makeLogger(): LogCapture {
  const lines: string[] = [];
  return {
    lines,
    logger: {
      log: (...args: unknown[]) => {
        lines.push(args.map(String).join(" "));
      },
    },
  };
}

describe("listIssuesPaginated (integration)", () => {
  it("enumerates issues across pages and formats output", async () => {
    const issues = vi.fn()
      .mockResolvedValueOnce({
        nodes: [
          {
            id: "i1",
            title: "Fix login",
            state: Promise.resolve({ name: "Todo" }),
            project: () => Promise.resolve({ name: "Web" }),
            assignee: { name: "Ada" },
          },
          {
            id: "i2",
            identifier: "ENG-2",
          },
        ] as IssueLike[],
        pageInfo: { hasNextPage: true, endCursor: "cursor-1" },
      })
      .mockResolvedValueOnce({
        nodes: [
          {
            id: "i3",
            title: "Ship dashboard",
            state: () => Promise.resolve({ name: "In Progress" }),
          },
        ] as IssueLike[],
        pageInfo: { hasNextPage: false, endCursor: null },
      });

    const { logger, lines } = makeLogger();
    const total = await listIssuesPaginated({ issues }, { pageSize: 2, logger });

    expect(total).toBe(3);
    expect(issues).toHaveBeenCalledTimes(2);
    expect(issues).toHaveBeenNthCalledWith(1, { first: 2, after: undefined });
    expect(issues).toHaveBeenNthCalledWith(2, { first: 2, after: "cursor-1" });

    expect(lines[0]).toBe("Page 1 — 2 issues");
    expect(lines[1]).toBe("  - Fix login (id: i1) — [Todo] — project: Web — assignee: Ada");
    expect(lines[2]).toBe("  - ENG-2 (id: i2)");
    expect(lines[3]).toBe("Page 2 — 1 issue");
    expect(lines[4]).toBe("  - Ship dashboard (id: i3) — [In Progress]");
    expect(lines[5]).toBe("\nTotal issues listed: 3");
  });

  it("handles empty result sets", async () => {
    const issues = vi.fn().mockResolvedValueOnce({
      nodes: [],
      pageInfo: { hasNextPage: false, endCursor: null },
    });

    const { logger, lines } = makeLogger();
    const total = await listIssuesPaginated({ issues }, { pageSize: 10, logger });

    expect(total).toBe(0);
    expect(lines).toEqual(["Page 1 — 0 issues", "\nTotal issues listed: 0"]);
  });

  it("falls back to <untitled> when no title or identifier", async () => {
    const issues = vi.fn().mockResolvedValueOnce({
      nodes: [
        {
          id: "i4",
        },
      ] as IssueLike[],
      pageInfo: { hasNextPage: false, endCursor: null },
    });

    const { logger, lines } = makeLogger();
    const total = await listIssuesPaginated({ issues }, { logger });

    expect(total).toBe(1);
    expect(lines[0]).toBe("Page 1 — 1 issue");
    expect(lines[1]).toBe("  - <untitled> (id: i4)");
    expect(lines[2]).toBe("\nTotal issues listed: 1");
  });

  it("propagates client errors", async () => {
    const issues = vi.fn().mockRejectedValue(new Error("network down"));
    const { logger } = makeLogger();

    await expect(listIssuesPaginated({ issues }, { logger })).rejects.toThrow("network down");
  });
});
