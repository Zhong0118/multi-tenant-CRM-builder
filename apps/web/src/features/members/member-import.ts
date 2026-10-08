import { parseCsv } from "@/lib/csv";

export const MEMBER_IMPORT_MAX_ROWS = 100;
export const MEMBER_IMPORT_MAX_BYTES = 1024 * 1024;
export interface MemberImportRow {
  line: number;
  displayName: string;
  phone: string;
  role: "EMPLOYEE" | "TENANT_ADMIN";
  error?: string;
}

export function parseMemberImport(text: string): { rows: MemberImportRow[] } {
  if (new TextEncoder().encode(text).length > MEMBER_IMPORT_MAX_BYTES)
    throw new Error("名单不能超过 1 MB");
  const { headers, rows: cells } = parseCsv(text, {
    delimiter: text.split(/\r?\n/, 1)[0].includes("\t") ? "\t" : ",",
    strictColumnCount: true,
  });
  if (
    !headers.includes("姓名") ||
    !headers.includes("手机号") ||
    new Set(headers).size !== headers.length ||
    headers.some((h) => !["姓名", "手机号", "角色"].includes(h))
  ) {
    throw new Error(
      "表头必须包含姓名、手机号，可选角色；请勿包含密码或其他列。",
    );
  }
  if (!cells.length || cells.length > MEMBER_IMPORT_MAX_ROWS)
    throw new Error("每批请输入 1–100 位成员。");
  const rows = cells.map((values, index): MemberImportRow => {
    const displayName = values[headers.indexOf("姓名")].trim();
    const rawPhone = values[headers.indexOf("手机号")].trim();
    const phone = /^1[3-9]\d{9}$/.test(rawPhone) ? `+86${rawPhone}` : rawPhone;
    const roleText = values[headers.indexOf("角色")]?.trim() ?? "";
    const errors: string[] = [];
    if (!displayName || displayName.length > 100)
      errors.push("姓名须为 1–100 个字符");
    if (!/^\+861[3-9]\d{9}$/.test(phone)) errors.push("请输入有效的大陆手机号");
    if (
      ![
        "",
        "员工",
        "普通员工",
        "公司管理员",
        "EMPLOYEE",
        "TENANT_ADMIN",
      ].includes(roleText)
    )
      errors.push("角色须为员工或公司管理员");
    return {
      line: index + 2,
      displayName,
      phone,
      role: ["公司管理员", "TENANT_ADMIN"].includes(roleText)
        ? "TENANT_ADMIN"
        : "EMPLOYEE",
      ...(errors.length ? { error: errors.join("；") } : {}),
    };
  });
  const counts = new Map<string, number>();
  rows.forEach((row) =>
    counts.set(row.phone, (counts.get(row.phone) ?? 0) + 1),
  );
  rows.forEach((row) => {
    if ((counts.get(row.phone) ?? 0) > 1)
      row.error = [row.error, "手机号重复"].filter(Boolean).join("；");
  });
  return { rows };
}
