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
      expect(coerceImportValue("DATETIME", sheet.rows[0][2], [])).toBe(
        "2026-06-27T00:00:00.000Z",
      );
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
      ),
    ).rejects.toThrow(/表头/);
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
    );
    expect(csv).toContain("\uFEFF");
    expect(csv).toContain("格式不正确");
    expect(csv).toContain("'=CMD()");
    expect(csv).not.toContain("正常");
  });
});
