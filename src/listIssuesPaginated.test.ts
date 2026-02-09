import { describe, expect, it } from "vitest";
import { formatIssueLine, resolveRelation } from "./listIssuesPaginated";

describe("resolveRelation", () => {
  it("returns null for null or undefined", async () => {
    await expect(resolveRelation(null)).resolves.toBeNull();
    await expect(resolveRelation(undefined)).resolves.toBeNull();
  });

  it("resolves relation functions", async () => {
    const result = await resolveRelation(async () => ({ name: "Todo" }));
    expect(result).toEqual({ name: "Todo" });
  });

  it("resolves relation promises", async () => {
    const result = await resolveRelation(Promise.resolve({ name: "Done" }));
    expect(result).toEqual({ name: "Done" });
  });

  it("returns relation objects as-is", async () => {
    const obj = { name: "In Progress" };
    const result = await resolveRelation(obj);
    expect(result).toBe(obj);
  });

  it("propagates relation errors", async () => {
    await expect(
      resolveRelation(() => Promise.reject(new Error("boom")))
    ).rejects.toThrow("boom");
  });
});

describe("formatIssueLine", () => {
  it("formats the base line with title and id", () => {
    expect(
      formatIssueLine({
        title: "Login fails",
        id: "issue-1",
      })
    ).toBe("- Login fails (id: issue-1)");
  });

  it("includes optional segments in order", () => {
    expect(
      formatIssueLine({
        title: "Login fails",
        id: "issue-1",
        state: "Todo",
        project: "Web",
        assignee: "Ada",
      })
    ).toBe("- Login fails (id: issue-1) — [Todo] — project: Web — assignee: Ada");
  });
});
