import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const packageRoot = new URL("./", import.meta.url);

async function readJson(relativePath) {
  return JSON.parse(await readFile(new URL(relativePath, packageRoot), "utf8"));
}

test("shared packages expose the intended workspace identities", async () => {
  const contracts = await readJson("contracts/package.json");
  const tenantTemplates = await readJson("tenant-templates/package.json");

  assert.equal(contracts.name, "@crm/contracts");
  assert.equal(tenantTemplates.name, "@crm/tenant-templates");
});

test("shared packages keep generic contracts separate from tenant templates", async () => {
  const expectedFiles = [
    "contracts/src/auth/index.ts",
    "contracts/src/tenants/index.ts",
    "contracts/src/objects/index.ts",
    "contracts/src/records/index.ts",
    "tenant-templates/src/generic/index.ts",
    "tenant-templates/src/first-company/index.ts",
  ];

  await Promise.all(
    expectedFiles.map(async (relativePath) => {
      const contents = await readFile(
        new URL(relativePath, packageRoot),
        "utf8",
      );
      assert.ok(contents.length > 0, `${relativePath} must not be empty`);
    }),
  );
});

test("model SDK and raw provider construction stay behind governance in production", async () => {
  const src = new URL("../apps/api/src/", packageRoot);
  const { readdir } = await import("node:fs/promises");
  const allowed = new Set([
    "modules/ai/ai-provider.ts",
    "modules/ai/governance/governed-provider.ts",
    "modules/ai/providers/vercel-openai.provider.ts",
    "modules/ai/providers/metered-fake.provider.ts",
    "modules/ai/providers/fake-ai.provider.ts",
  ]);
  for (const file of await readdir(src, { recursive: true })) {
    if (!file.endsWith(".ts") || file.endsWith(".spec.ts") || allowed.has(file))
      continue;
    const text = await readFile(new URL(file, src), "utf8");
    assert.doesNotMatch(
      text,
      /\bcreateAiProvider\b|(?:\bfrom\s*|\b(?:import|require|requireFromModule)\s*\(\s*)["'](?:ai|@ai-sdk\/[^"']+|[^"']*\/(?:vercel-openai|fake-ai|metered-fake)\.provider)["']/,
      file,
    );
  }
  const factory = await readFile(
    new URL("modules/ai/governance/governed-provider.ts", src),
    "utf8",
  );
  assert.match(factory, /new ModelMeter\(/);
});
