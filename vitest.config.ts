import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["packages/*/src/**/*.ts"],
      exclude: ["packages/test-utils/**"],
      reporter: ["text", "lcov"],
      thresholds: { lines: 90, functions: 90, statements: 90, branches: 80 },
    },
  },
});
