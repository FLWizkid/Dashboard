import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // `server-only` is a build-time guard: importing it from a client
      // component is meant to fail the Next build. It ships no runtime, so it
      // cannot resolve under Vitest. Stubbing it keeps the guard doing its job
      // in the application while letting server modules be unit tested. The
      // alternative — dropping the guard so the code is testable — would
      // trade a real protection for a test convenience.
      "server-only": fileURLToPath(
        new URL("./tests/stubs/server-only.ts", import.meta.url),
      ),
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
