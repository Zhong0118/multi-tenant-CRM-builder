export function formatDashboardValue(
  value: number | null,
  format?: "NUMBER" | "MONEY" | "PERCENT",
) {
  if (value === null) return "—";
  if (format === "MONEY") {
    return new Intl.NumberFormat("zh-CN", {
      style: "currency",
      currency: "CNY",
      maximumFractionDigits: 0,
    }).format(value);
  }
  if (format === "PERCENT") return `${value.toFixed(1)}%`;
  return new Intl.NumberFormat("zh-CN").format(value);
}
