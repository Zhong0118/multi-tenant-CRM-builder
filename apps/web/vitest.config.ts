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
    // Ant Design component trees are slow to render under jsdom, and slower
    // still when the whole suite competes for workers. The default 5s trips on
    // table rows carrying popconfirms and links even though the assertions
    // themselves are synchronous.
    testTimeout: 20000,
  },
});
