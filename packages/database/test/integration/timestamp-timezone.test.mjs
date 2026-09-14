import assert from "node:assert/strict";
import { test } from "node:test";

import { createDatabaseClient } from "../../dist/index.js";

/**
 * The pg adapter renders timestamptz through the session time zone and then
 * reads that wall clock back as UTC. Under a non-UTC session that shifts every
 * timestamp by the offset: rows the application writes are stored that much
 * earlier, and values the database generates (now()) come back that much
 * later. Reading the value back through the same adapter hides the write-side
 * shift, so the stored instant itself is what this test asserts.
 */
test("application timestamps are stored as the instant that was written", async () => {
  const db = createDatabaseClient(process.env.TEST_DATABASE_ADMIN_URL);
  const rollback = new Error("rollback timestamp fixtures");
  const sample = new Date("2026-09-14T09:10:23.157Z");

  try {
    await assert.rejects(
      db.$transaction(async (tx) => {
        const [session] = await tx.$queryRawUnsafe(
          "SELECT current_setting('TimeZone') AS tz",
        );
        assert.equal(session.tz, "UTC");

        await tx.$executeRawUnsafe(
          "CREATE TEMP TABLE timestamp_probe (t timestamptz) ON COMMIT DROP",
        );
        await tx.$executeRawUnsafe(
          "INSERT INTO timestamp_probe (t) VALUES ($1)",
          sample,
        );
        const [stored] = await tx.$queryRawUnsafe(
          "SELECT t AT TIME ZONE 'UTC' AS as_utc, now() AS server_now FROM timestamp_probe",
        );
        assert.equal(
          new Date(stored.as_utc).toISOString(),
          sample.toISOString(),
          "the stored instant must equal the instant the application wrote",
        );
        assert.ok(
          Math.abs(new Date(stored.server_now).getTime() - Date.now()) < 10_000,
          "now() must arrive within ten seconds of the client clock",
        );
        throw rollback;
      }),
      (error) => error === rollback,
    );
  } finally {
    await db.$disconnect();
  }
});
