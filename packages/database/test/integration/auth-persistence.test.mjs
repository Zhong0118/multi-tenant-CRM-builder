import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { migrateTestDatabase, createTestClients } from "./helpers.mjs";

let admin;
let runtime;
let tenantId;
let invitationId;
let fixtureUserId;

before(async () => {
  migrateTestDatabase();
  ({ admin, runtime } = createTestClients());
  const tenant = await admin.tenant.create({
    data: { name: "Auth persistence test", code: `auth-${Date.now()}` },
  });
  tenantId = tenant.id;
  const user = await admin.user.create({
    data: {
      displayName: "Fixture",
      phone: `138${String(Date.now()).slice(-8)}`,
      phoneVerifiedAt: new Date(),
      passwordHash: "hash",
      isPlatformAdmin: false,
    },
  });
  fixtureUserId = user.id;
  const invitation = await admin.tenantInvitation.create({
    data: {
      tenantId,
      targetPhone: user.phone,
      targetUserId: null,
      role: "TENANT_ADMIN",
      invitationCodeHash: "hash",
      createdByUserId: user.id,
      expiresAt: new Date(Date.now() + 60_000),
    },
  });
  invitationId = invitation.id;
});

after(async () => {
  await admin.tenantInvitation.deleteMany({ where: { id: invitationId } });
  await admin.user.deleteMany({ where: { id: fixtureUserId } });
  await admin.tenant.deleteMany({ where: { id: tenantId } });
  await admin.$disconnect();
  await runtime.$disconnect();
});

test("runtime probe keeps draft bootstrap and excludes suspended or closed tenants", async () => {
  const invitation = await admin.tenantInvitation.findUniqueOrThrow({
    where: { id: invitationId },
    select: { targetPhone: true },
  });
  const [{ allowed: draft }] = await runtime.$queryRaw`
    SELECT public.has_pending_registration_invitation(${invitation.targetPhone}, now()) AS allowed
  `;
  assert.equal(draft, true);

  await admin.tenant.update({
    where: { id: tenantId },
    data: { status: "ACTIVE" },
  });
  const [{ allowed: active }] = await runtime.$queryRaw`
    SELECT public.has_pending_registration_invitation(${invitation.targetPhone}, now()) AS allowed
  `;
  assert.equal(active, true);

  await admin.tenant.update({
    where: { id: tenantId },
    data: { status: "SUSPENDED" },
  });
  const [{ allowed: suspended }] = await runtime.$queryRaw`
    SELECT public.has_pending_registration_invitation(${invitation.targetPhone}, now()) AS allowed
  `;
  assert.equal(suspended, false);

  await admin.tenant.update({
    where: { id: tenantId },
    data: { status: "CLOSED" },
  });
  const [{ allowed: closed }] = await runtime.$queryRaw`
    SELECT public.has_pending_registration_invitation(${invitation.targetPhone}, now()) AS allowed
  `;
  assert.equal(closed, false);
});

test("runtime role cannot directly inspect invitation or tenant rows", async () => {
  await runtime.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT set_config('app.user_id', '', true), set_config('app.tenant_id', '', true)`;
    assert.deepEqual(
      await tx.$queryRaw`SELECT tenant_id FROM tenant_invitations WHERE id = ${invitationId}`,
      [],
    );
    assert.deepEqual(
      await tx.$queryRaw`SELECT id, status FROM tenants WHERE id = ${tenantId}`,
      [],
    );
  });
  const roles =
    await runtime.$queryRaw`SELECT rolname, rolsuper, rolbypassrls, rolcanlogin FROM pg_roles WHERE rolname IN ('crm_app', 'crm_registration_probe') ORDER BY rolname`;
  assert.deepEqual(roles, [
    {
      rolname: "crm_app",
      rolsuper: false,
      rolbypassrls: false,
      rolcanlogin: true,
    },
    {
      rolname: "crm_registration_probe",
      rolsuper: false,
      rolbypassrls: false,
      rolcanlogin: false,
    },
  ]);
  const [acl] =
    await runtime.$queryRaw`SELECT has_function_privilege('crm_app', 'public.has_pending_registration_invitation(text,timestamptz)', 'EXECUTE') AS app_execute, pg_has_role('crm_app', 'crm_registration_probe', 'MEMBER') AS probe_member`;
  assert.deepEqual(acl, { app_execute: true, probe_member: false });
});
