import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    // Unit tests live beside the code. Integration tests need a database, so
    // they sit under tests/integration and skip themselves without one.
    include: ["src/**/*.test.ts", "tests/integration/**/*.test.ts"],
    environment: "node",
  },
});
