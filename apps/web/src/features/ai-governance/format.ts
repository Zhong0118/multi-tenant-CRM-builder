const zhInteger = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 });

export function formatTokens(value: string | number | bigint) {
  // API counts may span the entire PostgreSQL bigint range.
  const n =
    typeof value === "number" ? BigInt(Math.round(value)) : BigInt(value);
  if (n < BigInt(10000)) return zhInteger.format(n) + " token";
  const tenths = (n + BigInt(500)) / BigInt(1000);
  return (
    zhInteger.format(tenths / BigInt(10)) +
    "." +
    (tenths % BigInt(10)) +
    " 万 token"
  );
}

export const formatPercent = (value: number) => value.toFixed(1) + "%";
