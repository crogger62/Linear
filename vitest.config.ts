import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: [
      "src/**/*.test.ts",
      "src/**/__tests__/**/*.test.ts",
      "tests/integration/**/*.test.ts",
    ],
    clearMocks: true,
  },
});
