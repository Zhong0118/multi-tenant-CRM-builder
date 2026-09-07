import { describe, expect, it } from "vitest";

import { coerceImportValue, parseCsv, suggestFieldKey } from "./record-csv";

describe("parseCsv", () => {
  it("strips a BOM and keeps quoted commas", () => {
    const parsed = parseCsv(
      '\uFEFF姓名,备注\r\n"张三","需要期刊,尽快"\n李四,普通',
    );
    expect(parsed.headers).toEqual(["姓名", "备注"]);
    expect(parsed.rows).toEqual([
      ["张三", "需要期刊,尽快"],
      ["李四", "普通"],
    ]);
  });
});

describe("suggestFieldKey", () => {
  const fields = [
    { fieldKey: "name", label: "姓名" },
    { fieldKey: "email", label: "邮箱" },
  ];

  it("matches a published label or field key", () => {
    expect(suggestFieldKey("姓名", fields)).toBe("name");
    expect(suggestFieldKey("email", fields)).toBe("email");
    expect(suggestFieldKey("未知", fields)).toBeUndefined();
  });
});

describe("coerceImportValue", () => {
  it("turns Excel-facing labels into published values", () => {
    expect(coerceImportValue("BOOLEAN", "是", [])).toBe(true);
    expect(coerceImportValue("NUMBER", "12", [])).toBe(12);
    expect(
      coerceImportValue("SINGLE_SELECT", "待联系", [
        { key: "new", label: "待联系" },
      ]),
    ).toBe("new");
    expect(coerceImportValue("DATETIME", "2026-08-21 10:30", [])).toBe(
      "2026-08-21T10:30:00.000Z",
    );
  });
});
