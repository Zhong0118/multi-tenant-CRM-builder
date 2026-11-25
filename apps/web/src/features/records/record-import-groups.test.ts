import { expect, it, vi } from "vitest";
import type { RecordImportInput, RecordImportResultItem } from "./record-api";
import { summarizeImport } from "./record-import-batches";
import {
  IMPORT_MANUAL_SKIP,
  resolveImportOwners,
  runGroupedImport,
  type GroupedImportPlan,
  type ImportDestination,
} from "./record-import-groups";

const a: ImportDestination = { kind: "member", id: "a" };
const b: ImportDestination = { kind: "member", id: "b" };
const row = (
  rowNumber: number,
  destination: ImportDestination,
  key = String(rowNumber),
) => ({
  rowNumber,
  destination,
  values: { key },
});
function reply(input: RecordImportInput) {
  return summarizeImport(
    input.rows.map((r): RecordImportResultItem => ({
      rowNumber: r.rowNumber,
      status: input.dryRun ? "READY" : "CREATED",
      ...(input.dryRun ? { matchKey: String(r.values.key).trim() } : {}),
    })),
  );
}
const shouldStop = () => false;
const plan: GroupedImportPlan = {
  batchId: "original-sheet",
  matchFields: ["key"],
  rows: [
    row(80, a, " X "),
    row(4, b, "X"),
    row(2, a, "X"),
    {
      ...row(3, a, "bad-conversion"),
      error: { code: "BAD_VALUE", message: "日期无效" },
    },
    row(5, { kind: "skip" }),
    row(81, { kind: "pool" }),
  ],
};

it("matches exact names only among active members and keeps unresolved names for a decision", () => {
  const members = [
    { id: "1", displayName: "张三" },
    { id: "2", displayName: "李四" },
    { id: "3", displayName: "李四" },
    { id: "4", displayName: "王五", status: "DISABLED" as const },
    { id: "5", displayName: null },
  ];
  const groups = resolveImportOwners(
    ["张三", "张三", "李四", "王五", "", "张 三", " 张三", "__proto__"],
    members,
  );
  expect(
    groups.map((g) => [g.name, g.count, g.matches.map((m) => m.id)]),
  ).toEqual([
    ["张三", 2, ["1"]],
    ["李四", 1, ["2", "3"]],
    ["王五", 1, []],
    ["", 1, []],
    ["张 三", 1, []],
    [" 张三", 1, []],
    ["__proto__", 1, []],
  ]);
});

it("checks owners serially, merges READY by original row number, and writes only checked winners", async () => {
  const request = vi.fn(async (input: RecordImportInput) => {
    const result = reply(input);
    if (input.dryRun && input.rows.some((r) => r.rowNumber === 2))
      result.items[0] = {
        rowNumber: 2,
        status: "FAILED",
        error: { code: "INVALID", message: "无效" },
      };
    if (!input.dryRun && input.importToPool)
      result.items[0] = {
        rowNumber: 81,
        status: "SKIPPED",
        reason: "已有记录",
      };
    return result;
  });
  const checked = await runGroupedImport({ plan, request, shouldStop });
  expect(checked.items.map((i) => [i.rowNumber, i.status])).toEqual([
    [2, "FAILED"],
    [3, "FAILED"],
    [4, "READY"],
    [5, "SKIPPED"],
    [80, "SKIPPED"],
    [81, "READY"],
  ]);
  expect(checked.items.find((i) => i.rowNumber === 5)?.reason).toBe(
    IMPORT_MANUAL_SKIP,
  );
  expect(
    request.mock.calls.map(([input]) => [
      input.ownerMemberId,
      input.importToPool,
      input.rows.map((r) => r.rowNumber),
    ]),
  ).toEqual([
    ["a", undefined, [2, 80]],
    ["b", undefined, [4]],
    [undefined, true, [81]],
  ]);
  request.mockClear();
  const result = await runGroupedImport({ plan, checked, request, shouldStop });
  expect(
    request.mock.calls.map(([input]) => input.rows.map((r) => r.rowNumber)),
  ).toEqual([[4], [81]]);
  expect(
    request.mock.calls.every(
      ([input]) => input.batchId === "original-sheet" && !input.dryRun,
    ),
  ).toBe(true);
  expect(result).toMatchObject({ created: 1, skipped: 3, failed: 2 });
  expect(result.items.map((i) => i.rowNumber)).toEqual([2, 3, 4, 5, 80, 81]);
});

it("rejects incomplete checks, tracks only acknowledged writes, and rechecks uncertain rows", async () => {
  const partialPlan = {
    ...plan,
    rows: [row(2, a), row(3, b), row(4, { kind: "skip" })],
  };
  const request = vi.fn(async (input: RecordImportInput) => reply(input));
  request
    .mockImplementationOnce(async (i) => reply(i))
    .mockRejectedValueOnce(new Error("断线"));
  await expect(
    runGroupedImport({ plan: partialPlan, request, shouldStop }),
  ).rejects.toThrow("断线");
  const checked = await runGroupedImport({
    plan: partialPlan,
    request,
    shouldStop,
  });
  const onProgress = vi.fn();
  request
    .mockImplementationOnce(async (i) => reply(i))
    .mockRejectedValueOnce(new Error("断线"));
  await expect(
    runGroupedImport({
      plan: partialPlan,
      checked,
      request,
      onProgress,
      shouldStop,
    }),
  ).rejects.toThrow("断线");
  const previous = onProgress.mock.calls.at(-1)![0];
  expect(
    previous.items.map((i: RecordImportResultItem) => [i.rowNumber, i.status]),
  ).toEqual([
    [2, "CREATED"],
    [4, "SKIPPED"],
  ]);
  request
    .mockClear()
    .mockResolvedValueOnce(
      summarizeImport([
        { rowNumber: 3, status: "SKIPPED", reason: "该行已导入。" },
      ]),
    );
  const rechecked = await runGroupedImport({
    plan: partialPlan,
    previousCreated: previous.items,
    request,
    shouldStop,
  });
  expect(
    request.mock.calls.map(([input]) => input.rows.map((r) => r.rowNumber)),
  ).toEqual([[3]]);
  expect(rechecked).toMatchObject({ created: 1, skipped: 2, failed: 0 });
});

it("rejects a cancelled or incomplete run before a checked plan can be confirmed", async () => {
  const request = vi.fn(async (i: RecordImportInput) => reply(i));
  let stopped = false;
  request.mockImplementationOnce(async (input) => {
    stopped = true;
    return reply(input);
  });
  await expect(
    runGroupedImport({ plan, request, shouldStop: () => stopped }),
  ).rejects.toThrow();
  const incomplete = summarizeImport([{ rowNumber: 4, status: "READY" }]);
  request.mockClear();
  await expect(
    runGroupedImport({ plan, checked: incomplete, request, shouldStop }),
  ).rejects.toThrow();
  expect(request).not.toHaveBeenCalled();
});

it("retains 100-row batch boundaries, skips later keys within one group and sends no employee ownership parameters", async () => {
  const rows = Array.from({ length: 102 }, (_, i) =>
    row(i + 10, { kind: "default" }, String(i % 100)),
  );
  const request = vi.fn(async (i: RecordImportInput) => reply(i));
  const checked = await runGroupedImport({
    plan: { ...plan, rows },
    request,
    shouldStop,
  });
  expect(request.mock.calls.map(([i]) => i.rows.length)).toEqual([100, 2]);
  expect(
    request.mock.calls.every(
      ([i]) => !("ownerMemberId" in i) && !("importToPool" in i),
    ),
  ).toBe(true);
  expect(checked.skipped).toBe(2);
  const noKeys = await runGroupedImport({
    plan: { ...plan, rows, matchFields: [] },
    request,
    shouldStop,
  });
  expect(noKeys.skipped).toBe(0);
});

it("keeps the in-flight write acknowledgement for list refresh when the drawer closes", async () => {
  const pending = { ...plan, rows: [row(2, a), row(3, b)] };
  const checked = await runGroupedImport({
    plan: pending,
    shouldStop,
    request: async (i) => reply(i),
  });
  let closed = false;
  const request = vi.fn(async (input: RecordImportInput) => {
    closed = true;
    return reply(input);
  });
  const onProgress = vi.fn();
  await expect(
    runGroupedImport({
      plan: pending,
      checked,
      request,
      onProgress,
      shouldStop: () => closed,
    }),
  ).rejects.toThrow();
  expect(request).toHaveBeenCalledTimes(1);
  expect(onProgress.mock.calls.at(-1)![0].items).toMatchObject([
    { rowNumber: 2, status: "CREATED" },
  ]);
});
