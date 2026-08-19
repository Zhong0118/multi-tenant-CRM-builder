import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import test from "node:test";

const root = new URL("./", import.meta.url);
const required = [
  "src/app/(auth)/login/page.tsx",
  "src/app/(auth)/register/page.tsx",
  "src/app/(account)/waiting/page.tsx",
  "src/app/(account)/workspaces/page.tsx",
  "src/app/(platform)/platform/layout.tsx",
  "src/app/(platform)/platform/page.tsx",
  "src/app/(platform)/platform/tenants/page.tsx",
  "src/app/(platform)/platform/templates/page.tsx",
  "src/app/(platform)/platform/jobs/page.tsx",
  "src/app/(platform)/platform/audit/page.tsx",
  "src/app/(platform)/platform/settings/page.tsx",
  "src/app/(workspace)/workspace/[tenantCode]/layout.tsx",
  "src/app/(workspace)/workspace/[tenantCode]/page.tsx",
  "src/app/(workspace)/workspace/[tenantCode]/objects/[objectCode]/page.tsx",
  "src/app/(workspace)/workspace/[tenantCode]/statistics/page.tsx",
  "src/app/(workspace)/workspace/[tenantCode]/members/page.tsx",
  "src/app/(workspace)/workspace/[tenantCode]/import-export/page.tsx",
  "src/app/(workspace)/workspace/[tenantCode]/audit/page.tsx",
  "src/app/(workspace)/workspace/[tenantCode]/settings/page.tsx",
  "src/app/error.tsx",
  "src/app/not-found.tsx",
  "src/components/layout/page-placeholder.tsx",
  "src/components/layout/platform-shell.tsx",
  "src/components/layout/workspace-shell.tsx",
  "src/features/auth/README.md",
  "src/features/tenants/README.md",
  "src/features/members/README.md",
  "src/features/objects/README.md",
  "src/features/records/README.md",
];
const removed = [
  "public/file.svg",
  "public/globe.svg",
  "public/next.svg",
  "public/vercel.svg",
  "public/window.svg",
  "src/app/page.module.css",
];

test("does not contain generated example assets", async () => {
  for (const path of removed) {
    await assert.rejects(access(new URL(path, root)));
  }
});

test("contains the approved Web architecture", async () => {
  for (const path of required) {
    await access(new URL(path, root));
  }
});
