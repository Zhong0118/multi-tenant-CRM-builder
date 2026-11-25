import { buildImportRows } from "./record-import-mapping";
import { coerceImportValue } from "./record-csv";
import { webcrypto } from "node:crypto";
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import {
  importBatchId,
  readImportFile,
  importFailureCsv,
} from "./record-import-file";

function file(bytes: Uint8Array, name: string) {
  return {
    name,
    size: bytes.byteLength,
    arrayBuffer: async () => bytes.buffer,
  } as File;
}

describe("record file import", () => {
  it.each(["xlsx", "xls"] as const)(
    "reads %s sheets, Chinese, zero prefixes and dates",
    async (bookType) => {
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.aoa_to_sheet([
        ["姓名", "编号", "日期", "手机号"],
        ["张三", 12, 46200, 17753397243],
        [],
        ["李四", "0003", null, "13800138000"],
      ]);
      ws.B2.z = "0000";
      ws.C2.z = "yyyy-mm-dd";
      ws.D2.z = "0.00E+00";
      XLSX.utils.book_append_sheet(wb, ws, "员工");
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.aoa_to_sheet([["姓名"], ["第二张"]]),
        "其他",
      );
      const bytes = new Uint8Array(XLSX.write(wb, { type: "array", bookType }));
      const imported = await readImportFile(
        file(bytes, `test.${bookType}`),
        "auto",
      );
      expect(imported.sheetNames).toEqual(["员工", "其他"]);
      const sheet = imported.sheet("员工");
      expect(sheet.rows[0]).toEqual([
        "张三",
        "0012",
        "2026-06-27",
        "17753397243",
      ]);
      expect(
        coerceImportValue("DATETIME", sheet.rows[0][2], [], {
          timeZone: "UTC",
        }),
      ).toBe("2026-06-27T00:00:00.000Z");
      expect(sheet.rowNumbers).toEqual([2, 4]);
      expect(imported.sheet("其他").rows).toEqual([["第二张"]]);
    },
  );
  it("automatically decodes GBK and preserves CSV source line numbers", async () => {
    const bytes = new Uint8Array([
      110, 97, 109, 101, 10, 10, 0xd5, 0xc5, 0xc8, 0xfd,
    ]);
    const parsed = await readImportFile(file(bytes, "old.csv"), "auto");
    expect(parsed.encoding).toBe("GBK / GB18030");
    expect(parsed.sheet("").rows).toEqual([["张三"]]);
    expect(parsed.sheet("").rowNumbers).toEqual([3]);
  });
  it("rejects fake Excel, oversize files and extra CSV columns", async () => {
    await expect(
      readImportFile(
        file(new TextEncoder().encode("name\na"), "fake.xls"),
        "auto",
      ),
    ).rejects.toThrow(/格式/);
    await expect(
      readImportFile({ name: "a.csv", size: 11 * 1024 * 1024 } as File, "auto"),
    ).rejects.toThrow(/10 MB/);
    await expect(
      readImportFile(
        file(new TextEncoder().encode("name\na,b"), "a.csv"),
        "auto",
      ).then((source) => source.sheet("")),
    ).rejects.toThrow(/表头/);
  });
  it("recognizes the third physical CSV line after a narrow title and preserves quoted records", async () => {
    const input =
      '\n"客户,清单"\r\n姓名,姓名,编号\r\n"李\n四",别名,0004\r\n\r\n王五,,0005';
    const source = await readImportFile(
      file(new TextEncoder().encode(input), "rows.csv"),
      "auto",
    );
    const fields = [
      { fieldKey: "name", label: "姓名" },
      { fieldKey: "code", label: "编号" },
    ];
    const choice = source.headerSelection("", fields);
    expect(choice).toMatchObject({ headerRow: 3, detected: true });
    expect(choice.candidates.map((row) => row.rowNumber)).toEqual([2, 3, 4, 7]);
    expect(source.sheet("", choice.headerRow)).toEqual({
      headers: ["姓名", "姓名", "编号"],
      rows: [
        ["李\n四", "别名", "0004"],
        ["王五", "", "0005"],
      ],
      rowNumbers: [4, 7],
    });
    expect(source.sheet("", 4).rowNumbers).toEqual([7]);
    expect(() => source.sheet("", 1)).toThrow(/表头/);
    expect(() => source.sheet("", 5)).toThrow(/表头/);
  });
  it("uses a unique shaped header and leaves ambiguous all-text rows for manual selection", async () => {
    const parse = (text: string) =>
      readImportFile(file(new TextEncoder().encode(text), "rows.csv"), "auto");
    const shaped = await parse("清单\n旧编号,旧金额\na,23\nb,45");
    expect(shaped.headerSelection("", [])).toMatchObject({
      headerRow: 2,
      detected: false,
    });
    const tied = await parse("名称,说明\n名称,别名\n张三,小张");
    expect(
      tied.headerSelection("", [{ fieldKey: "name", label: "名称" }]),
    ).toMatchObject({ headerRow: 1, detected: false });
    expect(tied.sheet("", 2)).toEqual({
      headers: ["名称", "别名"],
      rows: [["张三", "小张"]],
      rowNumbers: [3],
    });
  });
  it("uses the first sufficiently wide row followed by a comparable data row", async () => {
    const input = [
      "导出清单",
      "客户,票数," + "旧表备注".repeat(12),
      "甲,4,样本",
      ",,暂缺",
      "乙,12,",
      "丙,4,",
    ].join("\n");
    const source = await readImportFile(
      file(new TextEncoder().encode(input), "rows.csv"),
      "auto",
    );
    expect(source.headerSelection("", [])).toMatchObject({
      headerRow: 2,
      detected: false,
    });
  });
  it("leaves consecutive wide rows to the employee to confirm", async () => {
    const source = await readImportFile(
      file(
        new TextEncoder().encode(
          "部门清单\n公司,日期\n单位名称,签约时间\n示例公司,2026-10-01\n乙,2026-10-02",
        ),
        "headers.csv",
      ),
      "auto",
    );
    const choice = source.headerSelection("", []);
    expect(choice.detected).toBe(false);
    expect(choice.headerRow).toBe(2);
  });
  it("chooses the earliest plausible row when shape is the only evidence", async () => {
    const input = "旧表\n客户,金额\n甲,零元\n乙,30";
    const source = await readImportFile(
      file(new TextEncoder().encode(input), "rows.csv"),
      "auto",
    );
    expect(source.headerSelection("", [])).toMatchObject({
      headerRow: 2,
      detected: false,
    });
  });
  it("ranks distinct normalized matches above repeated labels and shape alone", async () => {
    const input =
      "姓名,姓名,姓名\n1,2,3\n　ＮＡＭＥ：, 编 号 ,备注\n张三,001,客户";
    const source = await readImportFile(
      file(new TextEncoder().encode(input), "rows.csv"),
      "auto",
    );
    const choice = source.headerSelection("", [
      { fieldKey: "name", label: "姓名" },
      { fieldKey: "code", label: "编号" },
    ]);
    expect(choice).toMatchObject({ headerRow: 3, detected: true });
    expect(source.sheet("", choice.headerRow).rows).toEqual([
      ["张三", "001", "客户"],
    ]);
  });
  it("rejects a manual header outside the first ten physical rows", async () => {
    const input = '"标题\n延续"\n' + "\n".repeat(8) + "姓名\n王五";
    const source = await readImportFile(
      file(new TextEncoder().encode(input), "rows.csv"),
      "auto",
    );
    expect(
      source
        .headerSelection("", [{ fieldKey: "name", label: "姓名" }])
        .candidates.map((row) => row.rowNumber),
    ).toEqual([1]);
    expect(() => source.sheet("", 11)).toThrow(/表头/);
  });
  it("preserves the default first nonempty row for the object-field importer", async () => {
    const source = await readImportFile(
      file(
        new TextEncoder().encode("\n".repeat(10) + "姓名\n张三"),
        "offset.csv",
      ),
      "auto",
    );
    expect(source.sheet("")).toEqual({
      headers: ["姓名"],
      rows: [["张三"]],
      rowNumbers: [12],
    });
    expect(() => source.headerSelection("", [])).toThrow(/前 10 行/);
  });
  it.each(["xls", "xlsx"] as const)(
    "keeps %s absolute column positions and row holes",
    async (bookType) => {
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.aoa_to_sheet([]);
      XLSX.utils.sheet_add_aoa(
        ws,
        [["旧清单"], [], ["姓名", null, "编号"], [], ["李四", null, "0008"]],
        { origin: "C2" },
      );
      ws["!ref"] = "C2:E6";
      XLSX.utils.book_append_sheet(wb, ws, "清单");
      const bytes = new Uint8Array(XLSX.write(wb, { type: "array", bookType }));
      const source = await readImportFile(
        file(bytes, `rows.${bookType}`),
        "auto",
      );
      const choice = source.headerSelection("清单", [
        { fieldKey: "name", label: "姓名" },
      ]);
      expect(choice).toMatchObject({ headerRow: 4, detected: true });
      expect(source.sheet("清单", choice.headerRow)).toEqual({
        headers: ["", "", "姓名", "", "编号"],
        rows: [["", "", "李四", "", "0008"]],
        rowNumbers: [6],
      });
    },
  );
  it.each(["csv", "xlsx"] as const)(
    "allows 10,000 data rows below the tenth %s row and rejects overflow",
    async (extension) => {
      async function load(count: number) {
        const data = Array.from({ length: 9 }, () => ["说明"]);
        data.push(["姓名"], ...Array.from({ length: count }, () => ["成员"]));
        if (extension === "csv")
          return readImportFile(
            file(new TextEncoder().encode(data.join("\n")), "rows.csv"),
            "auto",
          );
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(data), "清单");
        return readImportFile(
          file(
            new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" })),
            "rows.xlsx",
          ),
          "auto",
        );
      }
      const source = await load(10000);
      const name = source.sheetNames[0] ?? "";
      expect(source.sheet(name, 10).rowNumbers?.at(-1)).toBe(10010);
      expect(() => source.sheet(name, 9)).toThrow(/10000/);
      await expect(
        load(10005).then((source) => source.sheet(name, 10)),
      ).rejects.toThrow(/10000/);
    },
  );
  it("keeps sparse Excel data, its original whitespace, and its actual source row", async () => {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([["姓名", "备注"]]);
    XLSX.utils.sheet_add_aoa(ws, [["李四", "   "]], { origin: "A12000" });
    XLSX.utils.book_append_sheet(wb, ws, "稀疏表");
    const bytes = new Uint8Array(
      XLSX.write(wb, { type: "array", bookType: "xlsx" }),
    );
    const imported = await readImportFile(file(bytes, "sparse.xlsx"), "auto");
    expect(imported.sheet("稀疏表")).toEqual({
      headers: ["姓名", "备注"],
      rows: [["李四", "   "]],
      rowNumbers: [12000],
    });
  });
  it("rejects formula errors in Excel with the physical line number", async () => {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([["编号"], [], ["错误"]]);
    ws.A3 = { t: "e", v: 7, f: "1/0" };
    XLSX.utils.sheet_add_aoa(ws, [["cached"]], { origin: "A4" });
    ws.A4 = { t: "e", v: 42 };
    XLSX.utils.book_append_sheet(wb, ws, "清单");
    const source = await readImportFile(
      file(
        new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" })),
        "error.xlsx",
      ),
      "auto",
    );
    const parsed = source.sheet("清单");
    expect(parsed.rowNumbers).toEqual([3, 4]);
    expect(parsed.rows).toEqual([["#DIV/0!"], ["#N/A"]]);
    expect(parsed.formulaErrors).toEqual({ 3: [0] });
    const planned = buildImportRows({
      parsed,
      fields: [],
      mapping: [":skip"],
      dateOrders: {},
      destination: () => ({ kind: "default" }),
    });
    expect(planned[0]).toMatchObject({
      rowNumber: 3,
      error: {
        code: "RECORD_IMPORT_INVALID",
        message: "编号：公式错误 #DIV/0!",
      },
    });
    expect(planned[1].error).toBeUndefined();
  });
  it("rejects a formula with no cached result and keeps a calculated zero", async () => {
    const wb = XLSX.utils.book_new();
    for (const [name, cell] of [
      ["无结果", { t: "z", f: "1+1" }],
      ["已计算", { t: "n", f: "1-1", v: 0 }],
    ] as const) {
      const ws = XLSX.utils.aoa_to_sheet([["合计"], [""]]);
      ws.A2 = cell;
      XLSX.utils.book_append_sheet(wb, ws, name);
    }
    const source = await readImportFile(
      file(
        new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" })),
        "formulas.xlsx",
      ),
      "auto",
    );
    expect(() => source.sheet("无结果")).toThrow(/第 2 行.*公式/);
    expect(source.sheet("已计算").rows).toEqual([["0"]]);
  });
  it("applies the 40-column limit to the chosen table", async () => {
    const input = "说明" + ",".repeat(40) + "\n姓名,编号\n张三,3";
    const source = await readImportFile(
      file(new TextEncoder().encode(input), "wide.csv"),
      "auto",
    );
    expect(source.sheet("", 2).headers).toEqual(["姓名", "编号"]);
    expect(() => source.sheet("", 1)).toThrow(/40 列/);
  });
  it("same bytes and sheet retain a batch id, separate sheets do not", async () => {
    Object.defineProperty(globalThis.crypto, "subtle", {
      configurable: true,
      value: webcrypto.subtle,
    });
    const bytes = new TextEncoder().encode("name\na");
    const a = await importBatchId(bytes, "one");
    expect(a).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(await importBatchId(bytes, "one")).toBe(a);
    expect(await importBatchId(bytes, "two")).not.toBe(a);
  });
  it("downloads only failed rows with original cells and escaped spreadsheet formulas", () => {
    const csv = importFailureCsv(
      { headers: ["姓名"], rows: [["=CMD()"], ["正常"]], rowNumbers: [2, 3] },
      [
        {
          rowNumber: 2,
          status: "FAILED",
          error: {
            code: "FIELD_INVALID",
            message: "格式不正确",
            fields: ["name"],
          },
        },
      ],
      [{ fieldKey: "name", label: "姓名" }],
    );
    expect(csv).toContain("\uFEFF");
    expect(csv).toContain("第 2 行：姓名：格式不正确");
    expect(csv).toContain("'=CMD()");
    expect(csv).not.toContain("正常");
  });
});
