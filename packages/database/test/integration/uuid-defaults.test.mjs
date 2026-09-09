import assert from "node:assert/strict";
import { test } from "node:test";
import { createDatabaseClient } from "../../dist/index.js";

test("database creates UUIDv7 IDs when both Prisma and SQL omit the ID", async () => {
  const db = createDatabaseClient(process.env.TEST_DATABASE_ADMIN_URL);
  const rollback = new Error("rollback UUID regression fixtures");
  try {
    await assert.rejects(
      db.$transaction(async (tx) => {
        const tenant = await tx.tenant.create({
          data: { name: "UUID regression", code: "uuid-default-regression" },
        });
        assert.match(
          tenant.id,
          /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        );
        const [sql] = await tx.$queryRawUnsafe(
          "INSERT INTO tenants(name,code,updated_at) VALUES ('UUID SQL regression','uuid-sql-regression',now()) RETURNING id",
        );
        assert.match(
          sql.id,
          /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        );
        const ids = await tx.$queryRawUnsafe(
          "SELECT crm_uuid_v7()::text AS id FROM generate_series(1,100)",
        );
        assert.equal(new Set(ids.map((x) => x.id)).size, 100);
        for (const { id } of ids)
          assert.ok(
            Math.abs(
              Date.now() - parseInt(id.replaceAll("-", "").slice(0, 12), 16),
            ) < 10_000,
          );
        throw rollback;
      }),
      (error) => error === rollback,
    );
  } finally {
    await db.$disconnect();
  }
});
