import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import {
  cleanupTestFixtures,
  createTestClients,
  migrateTestDatabase,
  withSettings,
} from "./helpers.mjs";

const tenantCodes = ["dashboard-rls-a", "dashboard-rls-b"];
const phones = ["+8613800000901", "+8613800000902", "+8613800000903"];
let admin, runtime, tenantA, tenantB, manager, employee, platform, dashboardB;

before(async () => {
  migrateTestDatabase();
  ({ admin, runtime } = createTestClients());
  await cleanupTestFixtures(admin, { tenantCodes, phones });
  [manager, employee, platform] = await Promise.all(
    phones.map((phone, i) =>
      admin.user.create({
        data: {
          phone,
          displayName: `Dashboard role ${i}`,
          passwordHash: "test-only",
          phoneVerifiedAt: new Date(),
          isPlatformAdmin: i === 2,
        },
      }),
    ),
  );
  [tenantA, tenantB] = await Promise.all(
    tenantCodes.map((code) =>
      admin.tenant.create({ data: { code, name: code, status: "ACTIVE" } }),
    ),
  );
  await admin.tenantMember.createMany({
    data: [
      {
        tenantId: tenantA.id,
        userId: manager.id,
        role: "TENANT_ADMIN",
        status: "ACTIVE",
      },
      {
        tenantId: tenantA.id,
        userId: employee.id,
        role: "EMPLOYEE",
        status: "ACTIVE",
      },
    ],
  });
  dashboardB = await admin.tenantDashboardConfiguration.create({
    data: {
      tenantId: tenantB.id,
      code: "home",
      name: "Other dashboard",
      draftConfiguration: {},
    },
  });
});

after(async () => {
  if (admin) await cleanupTestFixtures(admin, { tenantCodes, phones });
  await Promise.allSettled([admin?.$disconnect(), runtime?.$disconnect()]);
});

const settings = () => ({ userId: manager.id, tenantId: tenantA.id });
const setDefault = (context, data, id = tenantA.id) =>
  withSettings(runtime, context, (tx) =>
    tx.tenant.update({ where: { id }, data }),
  );

test("ordinary company admin can atomically create the first dashboard and set both defaults", async () => {
  const saved = await withSettings(runtime, settings(), async (tx) => {
    const dashboard = await tx.tenantDashboardConfiguration.create({
      data: {
        tenantId: tenantA.id,
        code: "home",
        name: "First dashboard",
        draftConfiguration: {},
      },
    });
    await tx.tenant.update({
      where: { id: tenantA.id },
      data: {
        defaultAdminDashboardId: dashboard.id,
        defaultEmployeeDashboardId: dashboard.id,
      },
    });
    return dashboard;
  });
  const tenant = await admin.tenant.findUnique({ where: { id: tenantA.id } });
  assert.equal(tenant.defaultAdminDashboardId, saved.id);
  assert.equal(tenant.defaultEmployeeDashboardId, saved.id);
  const cleared = await setDefault(settings(), {
    defaultEmployeeDashboardId: null,
  });
  assert.equal(cleared.defaultEmployeeDashboardId, null);
});

test("default-dashboard access does not grant platform edits or cross-company writes", async () => {
  for (const data of [
    { status: "CLOSED" },
    { name: "Hijacked" },
    { code: "hijacked" },
    { settings: { arbitrary: true } },
    { timezone: "UTC" },
    { locale: "en-US" },
    { activatedAt: new Date() },
    { createdAt: new Date(0) },
  ]) {
    await assert.rejects(() => setDefault(settings(), data));
  }
  await assert.rejects(() =>
    setDefault(settings(), { defaultAdminDashboardId: dashboardB.id }),
  );
  await assert.rejects(() =>
    setDefault(settings(), { defaultAdminDashboardId: null }, tenantB.id),
  );
  await assert.rejects(() =>
    setDefault(
      { userId: manager.id, tenantId: tenantB.id },
      { defaultAdminDashboardId: null },
      tenantB.id,
    ),
  );
  await assert.rejects(() =>
    setDefault(
      { userId: employee.id, tenantId: tenantA.id },
      { defaultAdminDashboardId: null },
    ),
  );
  await assert.rejects(() =>
    setDefault({ userId: manager.id }, { defaultAdminDashboardId: null }),
  );
  await assert.rejects(() =>
    setDefault({ tenantId: tenantA.id }, { defaultAdminDashboardId: null }),
  );
});

test("disabled members, disabled users and suspended companies cannot change defaults", async () => {
  await admin.tenantMember.updateMany({
    where: { userId: manager.id },
    data: { status: "DISABLED" },
  });
  await assert.rejects(() =>
    setDefault(settings(), { defaultAdminDashboardId: null }),
  );
  await admin.tenantMember.updateMany({
    where: { userId: manager.id },
    data: { status: "ACTIVE" },
  });
  await admin.user.update({
    where: { id: manager.id },
    data: { status: "DISABLED" },
  });
  await assert.rejects(() =>
    setDefault(settings(), { defaultAdminDashboardId: null }),
  );
  await admin.user.update({
    where: { id: manager.id },
    data: { status: "ACTIVE" },
  });
  await admin.tenant.update({
    where: { id: tenantA.id },
    data: { status: "SUSPENDED" },
  });
  await assert.rejects(() =>
    setDefault(settings(), { defaultAdminDashboardId: null }),
  );
  await admin.tenant.update({
    where: { id: tenantA.id },
    data: { status: "ACTIVE" },
  });
});

test("platform administrators retain company lifecycle management", async () => {
  const changed = await setDefault(
    { userId: platform.id },
    { name: "Platform rename", status: "SUSPENDED" },
  );
  assert.equal(changed.name, "Platform rename");
  assert.equal(changed.status, "SUSPENDED");
});
