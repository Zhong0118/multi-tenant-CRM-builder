import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createTestClients, migrateTestDatabase } from "./helpers.mjs";

let admin, runtime, uid;
before(async () => {
  migrateTestDatabase();
  ({ admin, runtime } = createTestClients());
  const user = await admin.user.create({
    data: {
      phone: "mail-" + randomUUID().slice(0, 12),
      phoneVerifiedAt: new Date(),
      displayName: "Mail test",
      passwordHash: "unused",
    },
  });
  uid = user.id;
});
after(async () => {
  if (!admin) return;
  if (uid) await admin.user.delete({ where: { id: uid } });
  await Promise.all([admin.$disconnect(), runtime.$disconnect()]);
});

test("restricted runtime functions fence SMTP, clear snapshots and aggregate once", async () => {
  await assert.rejects(
    runtime.$queryRaw`SELECT old_email FROM mail_deliveries LIMIT 1`,
    /permission denied/,
  );
  const event = randomUUID(),
    addr = "old@example.test";
  const enqueue = () =>
    runtime.$queryRaw`SELECT mail_enqueue(${event},'email_changed',${uid}::uuid,1,'o***@example.test',${addr},null,null,now())`;
  await Promise.all([enqueue(), enqueue()]);
  const [rows] =
    await admin.$queryRaw`SELECT count(*)::int AS n FROM mail_deliveries WHERE dedupe_key=${event}`;
  assert.equal(rows.n, 1);
  const claims = (
    await Promise.all(
      [1, 2].map(() => runtime.$queryRaw`SELECT * FROM mail_claim(5)`),
    )
  ).flat();
  const one = claims.find((c) => c.user_id === uid);
  assert.ok(one);
  assert.equal(claims.filter((c) => c.user_id === uid).length, 1);
  await admin.$executeRaw`UPDATE mail_deliveries SET lease_until=now()-interval '1 minute' WHERE id=${one.id}::uuid`;
  const [next] =
    await runtime.$queryRaw`SELECT * FROM mail_claim(5) WHERE user_id=${uid}::uuid`;
  assert.notEqual(one.token, next.token);
  const start = (token) =>
    runtime.$queryRaw`SELECT mail_start(${one.id}::uuid,${token}::uuid) AS ok`;
  assert.equal((await start(one.token))[0].ok, false);
  assert.equal((await start(next.token))[0].ok, true);
  await admin.$executeRaw`UPDATE mail_deliveries SET lease_until=now()-interval '1 minute' WHERE id=${one.id}::uuid`;
  await runtime.$queryRaw`SELECT mail_maintain()`;
  const [ended] =
    await admin.$queryRaw`SELECT status,old_email,token,finished_at FROM mail_deliveries WHERE id=${one.id}::uuid`;
  assert.equal(ended.status, "unknown");
  assert.equal(ended.old_email, null);
  assert.equal(ended.token, null);
  const stats = await runtime.$queryRaw`SELECT * FROM mail_statistics()`;
  assert.ok(
    stats.some(
      (x) =>
        x.kind === "email_changed" && x.status === "unknown" && x.count > 0,
    ),
  );
  assert.deepEqual(Object.keys(stats[0]).sort(), ["count", "kind", "status"]);
  await admin.$executeRaw`UPDATE mail_deliveries SET finished_at=now()-interval '91 days' WHERE id=${one.id}::uuid`;
  await runtime.$queryRaw`SELECT mail_maintain()`;
  assert.equal(
    (
      await admin.$queryRaw`SELECT id FROM mail_deliveries WHERE id=${one.id}::uuid`
    ).length,
    0,
  );
});
