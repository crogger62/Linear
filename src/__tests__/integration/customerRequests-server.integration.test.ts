import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createApp, type LinearClientLike } from "../../customerRequests-server";

type IssueStub = { id: string; identifier: string; title?: string | null };
type Page<T> = { nodes: T[]; pageInfo: { hasNextPage: boolean; endCursor?: string | null } };

function makeIssue(overrides: Partial<IssueStub> = {}): IssueStub {
  return {
    id: "issue-id",
    identifier: "ENG-101",
    title: "Default title",
    ...overrides,
  };
}

function makeLinearClient(pages: Array<Page<IssueStub>>, projectsPage?: Page<unknown>): LinearClientLike {
  const issues = vi.fn();
  pages.forEach((page) => {
    issues.mockResolvedValueOnce(page);
  });
  const projects = vi.fn().mockResolvedValue(
    projectsPage ?? { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } }
  );

  return { issues, projects } as unknown as LinearClientLike;
}

describe("GET /api/issues", () => {
  it("returns identifier matches with limit applied", async () => {
    const pages: Array<Page<IssueStub>> = [
      {
        nodes: [makeIssue({ id: "1", title: "First" }), makeIssue({ id: "2", title: "Second" })],
        pageInfo: { hasNextPage: true, endCursor: "next" },
      },
      {
        nodes: [makeIssue({ id: "3", title: "Third" })],
        pageInfo: { hasNextPage: false, endCursor: null },
      },
    ];
    const linear = makeLinearClient(pages);
    const app = createApp(linear);

    const res = await request(app).get("/api/issues").query({ query: "eng-101", limit: "2" });

    expect(res.status).toBe(200);
    expect(res.body.issues).toHaveLength(2);
    expect(res.body.issues[0]).toMatchObject({ id: "1", identifier: "ENG-101", title: "First" });

    const issuesCalls = (linear as any).issues.mock.calls;
    expect(issuesCalls[0][0].filter).toEqual({
      number: { eq: 101 },
      team: { key: { eq: "ENG" } },
    });
  });

  it("filters by title or identifier and defaults invalid limit", async () => {
    const pages: Array<Page<IssueStub>> = [
      {
        nodes: [
          makeIssue({ id: "1", identifier: "OPS-7", title: "Fix login" }),
          makeIssue({ id: "2", identifier: "FIX-2", title: "Background jobs" }),
          makeIssue({ id: "3", identifier: "ENG-9", title: "Refactor API" }),
        ],
        pageInfo: { hasNextPage: false, endCursor: null },
      },
    ];
    const linear = makeLinearClient(pages);
    const app = createApp(linear);

    const res = await request(app).get("/api/issues").query({ query: "fix", limit: "abc" });

    expect(res.status).toBe(200);
    expect(res.body.issues).toHaveLength(2);
    expect(res.body.issues[0].identifier).toBe("OPS-7");
    expect(res.body.issues[1].identifier).toBe("FIX-2");
  });

  it("returns 500 when Linear issues fetch fails", async () => {
    const linear = makeLinearClient([]);
    (linear as any).issues.mockRejectedValueOnce(new Error("boom"));
    const app = createApp(linear);

    const res = await request(app).get("/api/issues");

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "Failed to fetch issues" });
  });
});
