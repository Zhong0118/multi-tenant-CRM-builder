import { describe, expect, it } from "vitest";

import {
  coerceImportValue,
  decodeRecordCsv,
  parseCsv,
  suggestFieldKey,
} from "./record-csv";

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

// Byte fixtures cover the file boundary; decoding must not silently replace Chinese text.
describe("decodeRecordCsv", () => {
  it("reads UTF-8 with or without a BOM", () => {
    for (const text of ["姓名\n张三", "\uFEFF姓名\n张三"]) {
      expect(decodeRecordCsv(new TextEncoder().encode(text), "auto")).toEqual({
        text: "姓名\n张三",
        encoding: "UTF-8",
      });
    }
  });
  it("requires an explicit encoding for legacy Chinese bytes", () => {
    const bytes = new Uint8Array([
      110, 97, 109, 101, 10, 0xd5, 0xc5, 0xc8, 0xfd,
    ]);
    expect(() => decodeRecordCsv(bytes, "auto")).toThrow(/无法按 UTF-8 读取/);
    expect(decodeRecordCsv(bytes, "gb18030")).toEqual({
      text: "name\n张三",
      encoding: "GBK / GB18030",
    });
  });
  it("recognizes UTF-16 BOMs but rejects damaged or already-replaced text", () => {
    expect(
      decodeRecordCsv(
        new Uint8Array([
          255, 254, 0xd3, 0x59, 0x0d, 0x54, 10, 0, 0x20, 0x5f, 0x09, 0x4e,
        ]),
        "auto",
      ).text,
    ).toBe("姓名\n张三");
    expect(
      decodeRecordCsv(
        new Uint8Array([
          254, 255, 0x59, 0xd3, 0x54, 0x0d, 0, 10, 0x5f, 0x20, 0x4e, 0x09,
        ]),
        "auto",
      ).text,
    ).toBe("姓名\n张三");
    expect(() =>
      decodeRecordCsv(new Uint8Array([255, 254, 1]), "auto"),
    ).toThrow();
    expect(() =>
      decodeRecordCsv(new TextEncoder().encode("name\n�"), "auto"),
    ).toThrow(/替代字符/);
    expect(() => decodeRecordCsv(new Uint8Array([0, 1, 2]), "auto")).toThrow(
      /不是有效的 CSV 文本/,
    );
  });
});

it("maps multi-select labels separated by Chinese semicolons to existing keys", () => {
  expect(
    coerceImportValue("MULTI_SELECT", "重点；已联系", [
      { key: "important", label: "重点" },
      { key: "contacted", label: "已联系" },
    ]),
  ).toEqual(["important", "contacted"]);
  expect(
    coerceImportValue("SINGLE_SELECT", "未知状态", [
      { key: "new", label: "待联系" },
    ]),
  ).toBe("未知状态");
});

it("does not guess between duplicate field labels and gives explicit keys priority", () => {
  const fields = [
    { fieldKey: "n7", label: "当前状态" },
    { fieldKey: "b7", label: "当前状态" },
    { fieldKey: "other", label: "n7" },
  ];
  expect(suggestFieldKey("当前状态", fields)).toBeUndefined();
  expect(suggestFieldKey("n7", fields)).toBe("n7");
  expect(suggestFieldKey("B7", fields)).toBe("b7");
});
