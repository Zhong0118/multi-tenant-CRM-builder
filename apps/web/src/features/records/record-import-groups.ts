import type { DynamicFieldMember } from "./dynamic-field";
import type {
  RecordImportInput,
  RecordImportResult,
  RecordImportResultItem,
  RecordImportRow,
} from "./record-api";
import { runImportBatches, summarizeImport } from "./record-import-batches";

export type ImportDestination =
  | { kind: "default" | "unassigned" | "pool" | "skip" }
  | { kind: "member"; id: string };

export interface PlannedImportRow extends RecordImportRow {
  destination: ImportDestination;
  error?: RecordImportResultItem["error"];
}

export interface GroupedImportPlan {
  batchId: string;
  matchFields: string[];
  rows: PlannedImportRow[];
}

export const IMPORT_MANUAL_SKIP = "已选择不导入这些行";

export function resolveImportOwners(
  names: readonly string[],
  members: readonly DynamicFieldMember[],
) {
  const membersByName = new Map<string, DynamicFieldMember[]>();
  for (const member of members) {
    if (member.status === "DISABLED" || !member.displayName?.trim()) continue;
    const matches = membersByName.get(member.displayName) ?? [];
    matches.push(member);
    membersByName.set(member.displayName, matches);
  }
  const counts = new Map<string, number>();
  for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1);
  return Array.from(counts, ([name, count]) => ({
    name,
    count,
    matches: membersByName.get(name) ?? [],
  }));
}

type GroupedRun = {
  plan: GroupedImportPlan;
  checked?: RecordImportResult;
  previousCreated?: RecordImportResultItem[];
  request: (input: RecordImportInput) => Promise<RecordImportResult>;
  shouldStop: () => boolean;
  onProgress?: (
    result: RecordImportResult,
    done: number,
    total: number,
  ) => void;
};

export async function runGroupedImport({
  plan,
  checked,
  previousCreated = [],
  request,
  shouldStop,
  onProgress,
}: GroupedRun): Promise<RecordImportResult> {
  const rows = [...plan.rows].sort((a, b) => a.rowNumber - b.rowNumber);
  const dryRun = !checked;
  const checkedByRow = new Map(
    checked?.items.map((item) => [item.rowNumber, item]),
  );
  const createdByRow = new Map(
    previousCreated
      .filter((item) => item.status === "CREATED")
      .map((item) => [item.rowNumber, item]),
  );
  if (
    checked &&
    (checked.items.length !== rows.length ||
      !rows.every((row) => checkedByRow.has(row.rowNumber)))
  ) {
    throw new Error("检查结果不完整，请重新检查后继续。");
  }
  const known = new Map<number, RecordImportResultItem>();
  const groups = new Map<string, RecordImportInput>();
  for (const { rowNumber, values, destination, error } of rows) {
    const previous = createdByRow.get(rowNumber) ?? checkedByRow.get(rowNumber);
    if (previous && previous.status !== "READY") {
      known.set(rowNumber, previous);
    } else if (destination.kind === "skip") {
      known.set(rowNumber, {
        rowNumber,
        status: "SKIPPED",
        reason: IMPORT_MANUAL_SKIP,
      });
    } else if (error) {
      known.set(rowNumber, { rowNumber, status: "FAILED", error });
    } else {
      const groupKey =
        destination.kind === "member"
          ? "member:" + destination.id
          : destination.kind;
      let input = groups.get(groupKey);
      if (!input) {
        input = {
          batchId: plan.batchId,
          dryRun,
          matchFields: plan.matchFields,
          rows: [],
        };
        if (destination.kind === "member") input.ownerMemberId = destination.id;
        if (destination.kind === "unassigned") input.ownerMemberId = null;
        if (destination.kind === "pool") input.importToPool = true;
        groups.set(groupKey, input);
      }
      input.rows.push({ rowNumber, values });
    }
  }

  function result() {
    return summarizeImport(
      [...known.values()].sort((a, b) => a.rowNumber - b.rowNumber),
    );
  }
  function progress() {
    onProgress?.(result(), known.size, rows.length);
  }
  progress();
  for (const input of groups.values()) {
    await runImportBatches({
      input,
      request,
      shouldStop,
      onBatch(batch) {
        for (const item of batch.items) known.set(item.rowNumber, item);
        progress();
      },
    });
    if (shouldStop()) throw new Error("本次导入已中止，请重新检查。");
  }
  if (shouldStop() || known.size !== rows.length)
    throw new Error("导入结果不完整，请重新检查后继续。");

  // Groups can finish in a different order than the physical sheet.
  if (dryRun && plan.matchFields.length) {
    const seen = new Set<string>();
    for (const { rowNumber } of rows) {
      const item = known.get(rowNumber)!;
      if (item.status !== "READY" || !item.matchKey) continue;
      if (seen.has(item.matchKey)) {
        known.set(rowNumber, {
          rowNumber,
          status: "SKIPPED",
          reason: "文件内查重字段重复",
        });
      } else seen.add(item.matchKey);
    }
  }
  return result();
}
