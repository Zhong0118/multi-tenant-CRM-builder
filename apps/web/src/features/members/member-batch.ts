import { toApiError } from "@/lib/api/api-error";

export interface MemberBatchRow<T> {
  item: T;
  status: "pending" | "success" | "error";
  error?: string;
}

export async function runMemberBatch<T>(
  rows: MemberBatchRow<T>[],
  work: (item: T) => Promise<unknown>,
  onProgress: (rows: MemberBatchRow<T>[]) => void,
): Promise<MemberBatchRow<T>[]> {
  const result = rows.map((row) => ({ ...row }));
  for (const row of result) {
    if (row.status === "success") continue;
    try {
      await work(row.item);
      row.status = "success";
      delete row.error;
    } catch (error) {
      row.status = "error";
      row.error =
        error instanceof Error ? error.message : toApiError(error).message;
    }
    onProgress(result.map((value) => ({ ...value })));
  }
  return result;
}
