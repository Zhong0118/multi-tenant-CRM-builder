import { expect, it, vi } from "vitest";
import { runImportBatches } from "./record-import-batches";
import type { RecordImportInput } from "./record-api";

const rows = Array.from({ length: 601 }, (_, i) => ({
  rowNumber: i + 2,
  values: { name: `员工${i}` },
}));
const reply = (input: RecordImportInput) => ({
  created: input.dryRun ? 0 : input.rows.length,
  failed: 0,
  items: input.rows.map((r) => ({
    rowNumber: r.rowNumber,
    status: input.dryRun ? ("READY" as const) : ("CREATED" as const),
    matchKey: String(r.rowNumber % 100),
  })),
});
it("automatically batches 601 rows and detects duplicate keys across check batches", async () => {
  const request = vi.fn(async (input: RecordImportInput) => reply(input));
  const onBatch = vi.fn();
  await runImportBatches({
    input: { batchId: "stable", rows, dryRun: true },
    request,
    onBatch,
    shouldStop: () => false,
  });
  expect(request).toHaveBeenCalledTimes(7);
  expect(
    request.mock.calls.every(
      ([input]) => input.rows.length <= 100 && input.batchId === "stable",
    ),
  ).toBe(true);
  expect(
    onBatch.mock.calls
      .flatMap(([result]) => result.items)
      .filter((item) => item.status === "READY"),
  ).toHaveLength(100);
  expect(
    onBatch.mock.calls
      .flatMap(([result]) => result.items)
      .filter((item) => item.status === "SKIPPED"),
  ).toHaveLength(501);
});
it("stops on an unknown network result without resending or discarding prior batches", async () => {
  const request = vi
    .fn(async (input: RecordImportInput) => reply(input))
    .mockImplementationOnce(async (input) => reply(input))
    .mockRejectedValueOnce(new Error("network"));
  const onBatch = vi.fn();
  await expect(
    runImportBatches({
      input: { rows },
      request,
      onBatch,
      shouldStop: () => false,
    }),
  ).rejects.toThrow("network");
  expect(request).toHaveBeenCalledTimes(2);
  expect(onBatch).toHaveBeenCalledTimes(1);
});
it("stops after the in-flight batch when the drawer is closed", async () => {
  let stopped = false;
  const request = vi.fn(async (input: RecordImportInput) => {
    stopped = true;
    return reply(input);
  });
  await runImportBatches({
    input: { rows },
    request,
    onBatch: vi.fn(),
    shouldStop: () => stopped,
  });
  expect(request).toHaveBeenCalledTimes(1);
});

it("keeps UTF-8 request bodies below the API limit and reports oversized individual rows", async () => {
  const request = vi.fn(async (input: RecordImportInput) => reply(input));
  const onBatch = vi.fn();
  const largeRows = Array.from({ length: 30 }, (_, i) => ({
    rowNumber: i + 2,
    values: { name: "中".repeat(i === 0 ? 30000 : 2000) },
  }));
  await runImportBatches({
    input: { rows: largeRows },
    request,
    onBatch,
    shouldStop: () => false,
  });
  expect(
    request.mock.calls.every(
      ([input]) =>
        new TextEncoder().encode(JSON.stringify(input)).length < 90 * 1024,
    ),
  ).toBe(true);
  const items = onBatch.mock.calls.flatMap(([result]) => result.items);
  expect(items.find((item) => item.rowNumber === 2)?.status).toBe("FAILED");
  expect(items.filter((item) => item.status === "CREATED")).toHaveLength(29);
});
