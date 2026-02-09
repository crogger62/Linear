import { afterEach, describe, expect, it, vi } from "vitest";
import { getLinearApiKey, paginate } from "../customerRequests-server";

describe("customerRequests-server helpers", () => {
  const originalKey = process.env.LINEAR_API_KEY;

  afterEach(() => {
    if (originalKey === undefined) {
      delete process.env.LINEAR_API_KEY;
    } else {
      process.env.LINEAR_API_KEY = originalKey;
    }
  });

  it("getLinearApiKey trims whitespace and updates env", () => {
    process.env.LINEAR_API_KEY = "  test-key \n";

    const value = getLinearApiKey();

    expect(value).toBe("test-key");
    expect(process.env.LINEAR_API_KEY).toBe("test-key");
  });

  it("getLinearApiKey throws when missing or empty", () => {
    process.env.LINEAR_API_KEY = "   ";

    expect(() => getLinearApiKey()).toThrow("Missing or empty LINEAR_API_KEY");
  });

  it("paginate aggregates all pages in order", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce({
        nodes: [1, 2],
        pageInfo: { hasNextPage: true, endCursor: "next" },
      })
      .mockResolvedValueOnce({
        nodes: [3],
        pageInfo: { hasNextPage: false, endCursor: null },
      });

    const result = await paginate(fetch);

    expect(result).toEqual([1, 2, 3]);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenNthCalledWith(1, null);
    expect(fetch).toHaveBeenNthCalledWith(2, "next");
  });
});
