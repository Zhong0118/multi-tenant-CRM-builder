import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(
        new URL("./src/test/server-only.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "jsdom",
    exclude: ["architecture-contract.test.mjs", "node_modules/**"],
    setupFiles: ["./src/test/setup.ts"],
    // Rendering itself is cheap here; the cost is querying. Resolving an
    // accessible name (`getByRole` with a `name` filter) walks every candidate
    // element and asks jsdom for computed styles, which is slow under Ant
    // Design's stylesheet and slower still when the suite competes for workers.
    // Prefer getByText/getByLabelText for new assertions; this timeout only
    // covers the older named-role queries that have not been converted yet.
    testTimeout: 20000,
  },
});
