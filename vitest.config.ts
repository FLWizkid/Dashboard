import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    // Unit tests live beside the code — application code under src, the
    // dependency-free operations helpers under ops. Integration tests need a
    // database, so they sit under tests/integration and skip without one.
    include: [
      "src/**/*.test.ts",
      "ops/**/*.test.mts",
      "tests/integration/**/*.test.ts",
    ],
    environment: "node",
  },
});
