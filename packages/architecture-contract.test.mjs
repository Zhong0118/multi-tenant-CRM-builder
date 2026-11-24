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
    "modules/ai/providers/model-client.ts",
    "modules/ai/governance/model-runtime.ts",
    "modules/ai/providers/metered-fake.provider.ts",
    "modules/ai/providers/fake-ai.provider.ts",
  ]);
  for (const file of await readdir(src, { recursive: true })) {
    if (!file.endsWith(".ts") || file.endsWith(".spec.ts")) continue;
    const text = await readFile(new URL(file, src), "utf8");
    if (
      file.startsWith("modules/ai/") &&
      file !== "modules/ai/governance/model-transport.ts"
    ) {
      assert.doesNotMatch(
        text,
        /\bfetch\s*\(|["'](?:undici|axios|(?:node:)?https?)["']/,
        file + " must use the public HTTPS model transport",
      );
    }
    if (
      !file.startsWith("modules/ai/") &&
      /\bfetch\s*\(|["'](?:undici|axios|(?:node:)?https?)["']/.test(text)
    ) {
      assert.doesNotMatch(
        text,
        /AI_BASE_URL|api\.(?:openai|deepseek)\.com|\/(?:chat\/completions|embeddings|responses)["'`]/,
        file,
      );
    }
    if (allowed.has(file)) continue;
    if (file.startsWith("modules/ai/")) {
      assert.doesNotMatch(
        text,
        /type\s*:\s*["']image["']|mediaType\s*:\s*["']image\//,
        file,
      );
    }
    assert.doesNotMatch(
      text,
      /\b(?:createAiProvider|loadVercelOpenAiProvider|modelClient)\b|(?:\bfrom\s*|\b(?:import|require|requireFromModule)\s*\(\s*)["'](?:ai|@ai-sdk\/[^"']+|[^"']*\/(?:vercel-openai|fake-ai|metered-fake)\.provider)["']/,
      file,
    );
  }
  const adapter = await readFile(
    new URL("modules/ai/providers/model-client.ts", src),
    "utf8",
  );
  const meter = await readFile(
    new URL("modules/ai/governance/model-meter.ts", src),
    "utf8",
  );
  assert.match(adapter, /send: typeof fetch = modelFetch/);
  assert.match(meter, /await modelFetch\(url, init\)/);
  const factory = await readFile(
    new URL("modules/ai/governance/governed-provider.ts", src),
    "utf8",
  );
  assert.match(factory, /new ModelMeter\(/);
});
