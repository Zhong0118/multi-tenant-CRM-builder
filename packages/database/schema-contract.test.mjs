import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const schemaUrl = new URL("./prisma/schema.prisma", import.meta.url);

test("defines the core multi-tenant CRM models", async () => {
  const schema = await readFile(schemaUrl, "utf8");
  const models = [
    "User",
    "Tenant",
    "TenantMember",
    "TenantInvitation",
    "VerificationChallenge",
    "Session",
    "ObjectDefinition",
    "FieldDefinition",
    "ObjectPublication",
    "ViewDefinition",
    "ObjectPermission",
    "FieldPermission",
    "RecordCounter",
    "Record",
    "RecordActivity",
    "ObjectWorkflowDefinition",
    "WorkflowStateDefinition",
    "WorkflowTransitionDefinition",
    "RecordTransitionHistory",
  ];

  for (const model of models) {
    assert.match(schema, new RegExp(`model\\s+${model}\\s+\\{`));
  }

  assert.match(
    schema,
    /model\s+Record[\s\S]*tenantId\s+String\s+@map\("tenant_id"\)/,
  );
  assert.match(schema, /data\s+Json\s+@default\("\{\}"\)\s+@db\.JsonB/);
  assert.match(
    schema,
    /enum\s+RecordActivityType\s+\{[\s\S]*CALL[\s\S]*MESSAGE[\s\S]*MEETING[\s\S]*NOTE[\s\S]*STATUS_CHANGE[\s\S]*SYSTEM/,
  );
  assert.match(
    schema,
    /model\s+RecordActivity\s+\{[\s\S]*activityType\s+RecordActivityType[\s\S]*content\s+String[\s\S]*@@index\(\[tenantId,\s*recordId,\s*createdAt\(sort:\s*Desc\)\]\)/,
  );
});

test("defines tenant-scoped workflow drafts and append-only transition history", async () => {
  const schema = await readFile(schemaUrl, "utf8");

  assert.match(
    schema,
    /model\s+ObjectWorkflowDefinition\s+\{[\s\S]*objectDefinitionId\s+String[\s\S]*isEnabled\s+Boolean[\s\S]*initialStateKey\s+String\?[\s\S]*@@unique\(\[tenantId,\s*objectDefinitionId\]\)/,
  );
  assert.match(
    schema,
    /model\s+WorkflowStateDefinition\s+\{[\s\S]*key\s+String[\s\S]*isTerminal\s+Boolean[\s\S]*@@unique\(\[tenantId,\s*workflowDefinitionId,\s*key\]/,
  );
  assert.match(
    schema,
    /model\s+WorkflowTransitionDefinition\s+\{[\s\S]*fromStateKey\s+String[\s\S]*toStateKey\s+String[\s\S]*allowedRoles\s+MemberRole\[][\s\S]*requiredFieldKeys\s+String\[]/,
  );
  assert.match(
    schema,
    /model\s+RecordTransitionHistory\s+\{[\s\S]*transitionKey\s+String[\s\S]*toStateKey\s+String[\s\S]*recordVersionBefore\s+Int[\s\S]*recordVersionAfter\s+Int/,
  );
  assert.match(
    schema,
    /model\s+Record[\s\S]*statusKey\s+String\?\s+@map\("status_key"\)/,
  );

  const migration = await readFile(
    new URL(
      "./prisma/migrations/0017_workflow_state_machine/migration.sql",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /FORCE ROW LEVEL SECURITY/);
  assert.match(migration, /GRANT SELECT, INSERT ON TABLE "record_transition_histories"/);
  assert.match(
    migration,
    /GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE[\s\S]*"object_workflow_definitions"/,
  );
  assert.match(migration, /record_transition_histories are immutable/);
});

test("named dashboard migration can backfill publication owners past the immutability trigger", async () => {
  const migration = await readFile(
    new URL(
      "./prisma/migrations/0010_named_tenant_dashboards/migration.sql",
      import.meta.url,
    ),
    "utf8",
  );
  const disable =
    /ALTER TABLE "tenant_dashboard_publications"\s+DISABLE TRIGGER "tenant_dashboard_publications_immutable_update"/;
  const enable =
    /ALTER TABLE "tenant_dashboard_publications"\s+ENABLE TRIGGER "tenant_dashboard_publications_immutable_update"/;
  const backfill = migration.match(
    /DISABLE TRIGGER "tenant_dashboard_publications_immutable_update"([\s\S]*?)ENABLE TRIGGER "tenant_dashboard_publications_immutable_update"/,
  );

  assert.match(migration, disable);
  assert.match(migration, enable);
  assert.ok(backfill, "publication backfill must sit between disable and enable");
  assert.match(backfill[1], /SET "dashboard_id" = definition\."id"/);
});

test("defines named tenant dashboards with per-dashboard publications", async () => {
  const schema = await readFile(schemaUrl, "utf8");

  assert.match(schema, /enum\s+DashboardStatus\s+\{[\s\S]*ACTIVE[\s\S]*ARCHIVED/);
  assert.match(
    schema,
    /enum\s+DashboardAudience\s+\{[\s\S]*ALL[\s\S]*TENANT_ADMIN[\s\S]*EMPLOYEE/,
  );
  assert.match(
    schema,
    /model\s+Tenant\s+\{[\s\S]*?dashboardConfigurations\s+TenantDashboardConfiguration\[][\s\S]*?defaultAdminDashboardId\s+String\?\s+@map\("default_admin_dashboard_id"\)[\s\S]*?defaultEmployeeDashboardId\s+String\?\s+@map\("default_employee_dashboard_id"\)/,
  );
  assert.match(
    schema,
    /model\s+TenantDashboardConfiguration\s+\{[\s\S]*?id\s+String\s+@id[\s\S]*?code\s+String\s+@db\.VarChar\(64\)[\s\S]*?name\s+String\s+@db\.VarChar\(100\)[\s\S]*?status\s+DashboardStatus[\s\S]*?audience\s+DashboardAudience[\s\S]*?draftVersion\s+Int\s+@default\(1\)\s+@map\("version"\)[\s\S]*?@@unique\(\[tenantId,\s*code\]\)/,
  );
  assert.match(
    schema,
    /model\s+TenantDashboardPublication\s+\{[\s\S]*?dashboardId\s+String\s+@map\("dashboard_id"\)[\s\S]*?@@unique\(\[dashboardId,\s*publicationNo\]\)/,
  );
});

test("separates migration and runtime database credentials", async () => {
  const env = await readFile(
    new URL("../../.env.example", import.meta.url),
    "utf8",
  );
  const prismaConfig = await readFile(
    new URL("./prisma.config.ts", import.meta.url),
    "utf8",
  );

  assert.match(env, /^DATABASE_ADMIN_URL=/m);
  assert.match(env, /^DATABASE_URL=/m);
  assert.match(prismaConfig, /DATABASE_ADMIN_URL/);
});

test("defines append-only audit and tenant RLS", async () => {
  const schema = await readFile(schemaUrl, "utf8");

  assert.match(schema, /model AuditLog \{/);
  assert.match(schema, /enum AuditActorType \{/);

  const migration = await readFile(
    new URL(
      "./prisma/migrations/0001_account_workspace/migration.sql",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(migration, /CREATE UNIQUE INDEX.*tenant_invitations.*PENDING/is);
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /FORCE ROW LEVEL SECURITY/);
  assert.match(migration, /current_setting\('app\.tenant_id'/);
});

test("allows a verified user to discover invitations sent before registration", async () => {
  const migration = await readFile(
    new URL(
      "./prisma/migrations/0002_invitation_phone_access/migration.sql",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(migration, /target_phone/);
  assert.match(migration, /users.*phone/is);
  assert.match(migration, /current_setting\('app\.user_id', true\)/);
});
