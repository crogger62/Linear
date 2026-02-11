import { describe, expect, it, vi } from "vitest";
import { formatIssueLine, resolveRelation } from "../listIssuesPaginated";

describe("resolveRelation", () => {
  it("returns null for missing relations", async () => {
    await expect(resolveRelation(null)).resolves.toBeNull();
    await expect(resolveRelation(undefined)).resolves.toBeNull();
  });

  it("calls relation functions and returns the result", async () => {
    const rel = vi.fn(async () => ({ name: "In Progress" }));

    const result = await resolveRelation(rel);

    expect(rel).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ name: "In Progress" });
  });

  it("awaits promise relations", async () => {
    const promise = Promise.resolve({ name: "Done" });

    const result = await resolveRelation(promise);

    expect(result).toEqual({ name: "Done" });
  });

  it("returns already resolved objects", async () => {
    const rel = { name: "Backlog" };

    const result = await resolveRelation(rel);

    expect(result).toEqual({ name: "Backlog" });
  });
});

describe("formatIssueLine", () => {
  it("includes state, project, and assignee when provided", () => {
    const line = formatIssueLine(
      { id: "1", title: "Issue A", identifier: "TEAM-1" },
      "In Progress",
      "Project Alpha",
      "Sam"
    );

    expect(line).toBe("  - Issue A (id: 1) — [In Progress] — project: Project Alpha — assignee: Sam");
  });

  it("falls back to identifier when title is missing", () => {
    const line = formatIssueLine({ id: "2", title: null, identifier: "TEAM-2" });

    expect(line).toBe("  - TEAM-2 (id: 2)");
  });

  it("uses <untitled> when title and identifier are missing", () => {
    const line = formatIssueLine({ id: "3" });

    expect(line).toBe("  - <untitled> (id: 3)");
  });
});
