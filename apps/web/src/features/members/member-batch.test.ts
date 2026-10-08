import { expect, it } from "vitest";
import { runMemberBatch, type MemberBatchRow } from "./member-batch";

it("retains completed rows and retries only failures without overlapping writes", async () => {
  let active = 0;
  let maxActive = 0;
  const calls: number[] = [];
  const work = async (item: number) => {
    calls.push(item);
    active++;
    maxActive = Math.max(maxActive, active);
    await Promise.resolve();
    active--;
    if (item === 2 && calls.filter((x) => x === 2).length === 1)
      throw new Error("稍后重试");
  };
  const rows: MemberBatchRow<number>[] = [1, 2, 3].map((item) => ({
    item,
    status: "pending",
  }));
  const first = await runMemberBatch(rows, work, () => {});
  expect(first.map((x) => x.status)).toEqual(["success", "error", "success"]);
  const second = await runMemberBatch(first, work, () => {});
  expect(second.every((x) => x.status === "success")).toBe(true);
  expect(calls).toEqual([1, 2, 3, 2]);
  expect(maxActive).toBe(1);
});
