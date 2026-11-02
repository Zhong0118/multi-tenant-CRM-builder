export const transferLabels = {
  canImport: "导入记录",
  canExport: "下载数据（导出）",
} as const;
export type TransferKey = keyof typeof transferLabels;
export const transferKeys = ["canImport", "canExport"] as const;

type TablePolicy = {
  canRead: boolean;
  readScope: string;
  canCreate: boolean;
  canImport?: boolean;
  canExport?: boolean;
};

export function canTransfer(
  policy: TablePolicy | null | undefined,
  key: TransferKey,
) {
  return (
    !!policy?.canRead &&
    policy.readScope !== "NONE" &&
    (key !== "canImport" || policy.canCreate) &&
    (policy[key] ?? true)
  );
}
