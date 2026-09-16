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
    //
    // 20s was calibrated on a fast local machine and is not enough on a clean
    // GitHub runner: `template-editor.test.tsx` > "lets the template wrapper
    // inactivate and restore a field" needs 12.5s locally but 25.4s on
    // ubuntu-24.04, so it hit the budget and turned the Unit Tests gate red.
    // 60s keeps ~2.4x headroom over the worst observed case while still
    // bounding a genuinely hung test.
    testTimeout: 60000,
  },
});
