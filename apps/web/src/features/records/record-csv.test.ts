import { describe, expect, it } from "vitest";

import {
  coerceImportValue,
  decodeRecordCsv,
  inferImportDateOrder,
  matchImportOption,
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
  it.each([
    "DATE",
    "DATETIME",
    "NUMBER",
    "MONEY",
    "SINGLE_SELECT",
    "MULTI_SELECT",
  ])("reads whole-cell empty markers before converting %s", (type) => {
    for (const raw of [" NaN ", "#n/A", "N/A", " NULL "]) {
      expect(
        coerceImportValue(type, raw, [], {
          valueChoices: new Map([[raw.trim(), "unrelated"]]),
        }),
      ).toBeNull();
      expect(coerceImportValue("TEXT", raw, [])).toBe(raw.trim());
    }
    for (const raw of ["#REF!", "#DIV/0!", "#VALUE!"]) {
      expect(() =>
        coerceImportValue(type, raw, [], {
          valueChoices: new Map([[raw, null]]),
        }),
      ).toThrow(/公式/);
    }
  });
  it.each([
    ["2026.11.5", "2026-11-05"],
    ["2026/11/5", "2026-11-05"],
    ["2026-11-5", "2026-11-05"],
    ["26.11.2", "2026-11-02"],
    ["26/11/2", "2026-11-02"],
    ["26-11-2", "2026-11-02"],
    ["00.2.29", "2000-02-29"],
    ["99.12.31", "2099-12-31"],
  ])("normalizes year-first date %s for date fields", (raw, expected) => {
    expect(coerceImportValue("DATE", raw, [])).toBe(expected);
    expect(coerceImportValue("DATETIME", raw, [], { timeZone: "UTC" })).toBe(
      `${expected}T00:00:00.000Z`,
    );
  });

  it.each([
    "2026/2/31",
    "2026-02-31",
    "2026.2.29",
    "26.13.1",
    "2026/11-5",
    "11.2",
    "11/2/2026",
    "预计2026.11.5",
  ])("rejects invalid or ambiguous date %s", (raw) => {
    expect(() => coerceImportValue("DATE", raw, [])).toThrow();
    expect(() => coerceImportValue("DATETIME", raw, [])).toThrow();
  });

  it("turns Excel-facing labels into published values", () => {
    expect(coerceImportValue("BOOLEAN", "是", [])).toBe(true);
    expect(coerceImportValue("NUMBER", "12", [])).toBe(12);
    expect(
      coerceImportValue("SINGLE_SELECT", "待联系", [
        { key: "new", label: "待联系" },
      ]),
    ).toBe("new");
    expect(
      coerceImportValue("DATETIME", "2026-08-21 10:30", [], {
        timeZone: "Asia/Shanghai",
      }),
    ).toBe("2026-08-21T02:30:00.000Z");
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
  it("automatically detects legacy Chinese bytes", () => {
    const bytes = new Uint8Array([
      110, 97, 109, 101, 10, 0xd5, 0xc5, 0xc8, 0xfd,
    ]);
    expect(decodeRecordCsv(bytes, "auto").text).toBe("name\n张三");
    expect(() => decodeRecordCsv(bytes, "utf-8")).toThrow(/无法按 UTF-8 读取/);
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
  expect(() =>
    coerceImportValue("SINGLE_SELECT", "未知状态", [
      { key: "new", label: "待联系" },
    ]),
  ).toThrow(/选项/);
});

it("only maps unambiguous normalized keys and labels", () => {
  const fields = [
    { fieldKey: "n7", label: "当前状态" },
    { fieldKey: "b7", label: "当前状态" },
    { fieldKey: "other", label: "n7" },
  ];
  expect(suggestFieldKey("当前状态", fields)).toBeUndefined();
  expect(suggestFieldKey("n7", fields)).toBeUndefined();
  expect(suggestFieldKey("B7", fields)).toBe("b7");
});

it("imports a date-only Excel value into DATETIME as midnight", () => {
  expect(
    coerceImportValue("DATETIME", "2026-06-27", [], {
      timeZone: "Asia/Shanghai",
    }),
  ).toBe("2026-06-26T16:00:00.000Z");
});

it("tracks source lines through empty lines and quoted multiline cells", () => {
  const parsed = parseCsv('姓名,备注\n\n张三,"第一行\n第二行"\n李四,备注', {
    trackRowNumbers: true,
  });
  expect(parsed.rowNumbers).toEqual([3, 5]);
  expect(parsed.rows[0]).toEqual(["张三", "第一行\n第二行"]);
});

it("normalizes header width, spaces, case and final punctuation", () => {
  const fields = [{ fieldKey: "name", label: "客户名称" }];
  expect(suggestFieldKey(" 客 户名称：", fields)).toBe("name");
  expect(suggestFieldKey("Ｎ ＡＭＥ。", fields)).toBe("name");
  expect(suggestFieldKey(":", [{ fieldKey: "a", label: "" }])).toBeUndefined();
});

it("requires a unique normalized option and keeps first-seen multi-select order", () => {
  const options = [
    { key: "a", label: "A级" },
    { key: "b", label: "B级" },
  ];
  expect(
    coerceImportValue("MULTI_SELECT", " Ｂ 级，Ａ级；b,a", options),
  ).toEqual(["b", "a"]);
  expect(
    matchImportOption("A 级", [...options, { key: "another", label: "Ａ 级" }]),
  ).toBeUndefined();
  expect(() =>
    coerceImportValue("SINGLE_SELECT", "a", [
      ...options,
      { key: "another", label: "a" },
    ]),
  ).toThrow(/选项/);
});

describe("date order", () => {
  it("uses evidence from every year-last data row", () => {
    expect(
      inferImportDateOrder([
        "2024-03-20",
        "",
        ...Array(30).fill("3/5/2024"),
        "28/3/2024 10:01",
      ]),
    ).toBe("DMY");
    expect(inferImportDateOrder(["3/5/2024", "3/28/2024"])).toBe("MDY");
    expect(inferImportDateOrder(["3/5/2024"])).toBe("ambiguous");
    expect(inferImportDateOrder(["3/28/2024", "28/3/2024"])).toBe("conflict");
    expect(inferImportDateOrder(["2024-12-31"])).toBeUndefined();
  });
  it("ignores invalid clock and calendar evidence when deciding other rows", () => {
    expect(
      inferImportDateOrder([
        "30/2/2024",
        "25/3/2024 25:00",
        "26/3/2024 10:30+50:00",
        "3/20/2024",
      ]),
    ).toBe("MDY");
  });

  it("uses the selected order, validating the original calendar and clock", () => {
    expect(
      coerceImportValue("DATE", "3/5/2024", [], { dateOrder: "DMY" }),
    ).toBe("2024-05-03");
    expect(
      coerceImportValue("DATE", "3/5/2024", [], { dateOrder: "MDY" }),
    ).toBe("2024-03-05");
    for (const raw of ["13/14/2024", "31/2/2024", "0/2/2024", "29/2/2023"]) {
      expect(() =>
        coerceImportValue("DATE", raw, [], { dateOrder: "DMY" }),
      ).toThrow(/日期/);
    }
  });
});

describe("calendar dates and company wall-clock times", () => {
  it.each([
    "2024年2月29日 1:02:03",
    "20240229T01:02:03",
    "2024-02-29T01:02:03",
  ])("normalizes %s", (raw) => {
    expect(coerceImportValue("DATE", raw, [])).toBe("2024-02-29");
    expect(
      coerceImportValue("DATETIME", raw, [], { timeZone: "Asia/Shanghai" }),
    ).toBe("2024-02-28T17:02:03.000Z");
  });
  it("preserves zoned instants including fractions, independent of company time zone", () => {
    expect(
      coerceImportValue("DATETIME", "2024-02-29T23:59:50.123456+05:30", []),
    ).toBe("2024-02-29T18:29:50.123Z");
    expect(coerceImportValue("DATETIME", "2024-02-29T23:59:50Z", [])).toBe(
      "2024-02-29T23:59:50.000Z",
    );
  });
  it.each([
    "2023年2月29日",
    "20240230",
    "2024030510:30",
    "20240305 24:00",
    "2024-02-30T12:00Z",
    "2024-02-29T11:60:00Z",
    "2024-02-29T23:59:60Z",
    "2024-02-29T23:59+02:60",
  ])("rejects invalid calendar or clock %s", (raw) => {
    expect(() =>
      coerceImportValue("DATETIME", raw, [], { timeZone: "UTC" }),
    ).toThrow();
  });
  it("reports the unavailable company timezone and both DST discontinuities", () => {
    for (const timeZone of [undefined, "America/Invalid"]) {
      expect(() =>
        coerceImportValue("DATETIME", "20241106", [], { timeZone }),
      ).toThrow(/公司时区/);
    }
    for (const raw of ["2024-03-10 02:30", "2024-11-03 01:30"]) {
      expect(() =>
        coerceImportValue("DATETIME", raw, [], {
          timeZone: "America/New_York",
        }),
      ).toThrow(/偏移/);
    }
  });
});

describe("decimal imports", () => {
  it.each([
    ["12万", "120000"],
    ["12 万", "120000"],
    ["１２万", "120000"],
    ["1.2 万元", "12000"],
    ["1.2万", "12000"],
    ["3亿", "300000000"],
    ["¥1,200元", "1200"],
    ["1200元", "1200"],
    ["-0.00000123亿", "-123"],
    ["1.0000001万", "10000.001"],
    ["0.000000000123亿", "0.0123"],
  ])(
    "shifts %s exactly, even with a conflicting bare amount unit",
    (raw, expected) => {
      expect(
        coerceImportValue("MONEY", raw, [], { bareAmountUnit: "wan" }),
      ).toBe(expected);
      expect(coerceImportValue("NUMBER", raw, [])).toBe(Number(expected));
    },
  );
  it("rejects NUMBER values that JSON numbers would round or underflow", () => {
    for (const raw of [
      "9007199254740993",
      "0.1234567890123456789",
      "0." + "0".repeat(330) + "1",
    ]) {
      expect(() => coerceImportValue("NUMBER", raw, [])).toThrow(/精度|范围/);
    }
    expect(coerceImportValue("NUMBER", "0000.01000", [])).toBe(0.01);
    expect(coerceImportValue("NUMBER", "9007199254740992", [])).toBe(
      9007199254740992,
    );
  });

  it("preserves exact scientific and fractional NUMBER inputs accepted by older imports", () => {
    for (const value of ["1e5", "-1.25E-7", ".5", "1."]) {
      expect(coerceImportValue("NUMBER", value, [])).toBe(Number(value));
    }
    for (const value of ["9.007199254740993e15", "1e-400", "1e999"])
      expect(() => coerceImportValue("NUMBER", value, [])).toThrow();
    expect(() => coerceImportValue("MONEY", "1e5", [])).toThrow();
  });

  it("keeps exact money text and only scales bare inputs when requested", () => {
    expect(coerceImportValue("MONEY", "9007199254740993.12", [])).toBe(
      "9007199254740993.12",
    );
    expect(
      coerceImportValue("MONEY", "1.234567", [], { bareAmountUnit: "wan" }),
    ).toBe("12345.67");
    expect(
      coerceImportValue("MONEY", "¥1.25", [], { bareAmountUnit: "wan" }),
    ).toBe("1.25");
    expect(coerceImportValue("TEXT", "000234", [])).toBe("000234");
    expect(coerceImportValue("PHONE", "000234", [])).toBe("000234");
  });
  it.each([
    "1,20",
    "12,34,567",
    "Infinity",
    "--1",
    "1.3.4",
    "2万元元",
    "1 2 万",
    "十二万",
    "1.2 万 元",
    "9".repeat(310),
  ])("rejects invalid or nonfinite %s", (raw) => {
    for (const type of ["MONEY", "NUMBER"])
      expect(() => coerceImportValue(type, raw, [])).toThrow();
  });
});

it("recognizes the boolean tokens and distinguishes empty from invalid", () => {
  for (const raw of ["有", "Y", "y", "√"])
    expect(coerceImportValue("BOOLEAN", raw, [])).toBe(true);
  for (const raw of ["无", "N", "n", "×"])
    expect(coerceImportValue("BOOLEAN", raw, [])).toBe(false);
  expect(coerceImportValue("BOOLEAN", "  ", [])).toBeNull();
  expect(() => coerceImportValue("BOOLEAN", "可能", [])).toThrow();
});
