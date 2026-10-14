import { describe, expect, it } from "vitest";
import { coerceImportValue, suggestFieldKey } from "../records/record-csv";
import {
  suggestObjectFields,
  changeFileFieldType,
  buildFileObjectFields,
} from "./object-file-fields";

describe("suggestObjectFields", () => {
  it("keeps generated field keys from shadowing another source header during import", () => {
    const fields = suggestObjectFields({
      headers: ["名称", "col_1"],
      rows: [["客户", "备注"]],
    });
    for (const field of fields)
      expect(suggestFieldKey(field.sourceHeader, fields)).toBe(field.fieldKey);
  });
  it("only suggests datetime formats supported by the later record import", () => {
    const values = [
      "2026-10-14T12:30:00",
      "2026-10-14 12:30:00.123",
      "2026-10-14 12:30:00Z",
      "2026-10-14T12:30:00.123Z",
      "2026-10-14 12:30:00",
    ];
    expect(
      suggestObjectFields({
        headers: values.map(() => "时间"),
        rows: [values],
      }).map((f) => f.type),
    ).toEqual(["TEXT", "TEXT", "TEXT", "DATETIME", "DATETIME"]);
  });
  it("preserves phone numbers, identifiers, leading zeroes and long numbers as text", () => {
    const fields = suggestObjectFields({
      headers: ["手机号", "订单编号", "代码", "值"],
      rows: [
        ["17753397243", "123", "0012", "123456789012345678"],
        ["13800138000", "456", "0003", "123456789012345679"],
      ],
    });
    expect(fields.map((f) => f.type)).toEqual(["TEXT", "TEXT", "TEXT", "TEXT"]);
  });
  it("recognizes consistent columns and refuses mixed or impossible dates", () => {
    const fields = suggestObjectFields({
      headers: [
        "数量",
        "日期",
        "更新时间",
        "是否完成",
        "邮箱",
        "混合",
        "坏日期",
        "空列",
        "金额",
      ],
      rows: [
        [
          "12",
          "2026/10/14",
          "2026-10-14 00:00",
          "是",
          "a@b.com",
          "12",
          "2026-02-30",
          "",
          "12.34",
        ],
        [
          "3.5",
          "2026/10/15",
          "2026-10-15 12:30:00",
          "否",
          "c@b.com",
          "未知",
          "2026-01-10",
          "",
          "50",
        ],
      ],
    });
    expect(fields.map((f) => f.type)).toEqual([
      "NUMBER",
      "DATE",
      "DATETIME",
      "BOOLEAN",
      "EMAIL",
      "TEXT",
      "TEXT",
      "TEXT",
      "MONEY",
    ]);
    expect(fields.every((f) => !f.required)).toBe(true);
  });
  it("proposes select fields without guessing that every repeated name is an enum", () => {
    const fields = suggestObjectFields({
      headers: ["状态", "标签", "姓名"],
      rows: [
        ["在用", "重点；已联系", "张三"],
        ["闲置", "重点", "张三"],
      ],
    });
    expect(fields.map((f) => f.type)).toEqual(["TEXT", "TEXT", "TEXT"]);
    expect(fields.map((f) => f.suggestedType)).toEqual([
      "SINGLE_SELECT",
      "MULTI_SELECT",
      undefined,
    ]);
    expect(changeFileFieldType(fields[1], "MULTI_SELECT").optionText).toBe(
      "重点\n已联系",
    );
  });
  it("checks the entire column, not just the first preview rows", () => {
    const fields = suggestObjectFields({
      headers: ["数量"],
      rows: [...Array.from({ length: 200 }, () => ["12"]), ["未知"]],
    });
    expect(fields[0].type).toBe("TEXT");
  });
  it("gives blank and repeated headers editable unique labels and stable keys", () => {
    const fields = suggestObjectFields({
      headers: ["状态", "状态", "", "状态（2）"],
      rows: [["在用", "开启", "内容", "第三列"]],
    });
    expect(new Set(fields.map((f) => f.label)).size).toBe(4);
    expect(fields.map((f) => f.fieldKey)).toEqual([
      "col_1",
      "col_2",
      "col_3",
      "col_4",
    ]);
  });
});

describe("buildFileObjectFields", () => {
  it.each(["SINGLE_SELECT", "MULTI_SELECT"] as const)(
    "avoids source label collisions in generated %s option keys",
    (type) => {
      const field = changeFileFieldType(
        suggestObjectFields({
          headers: ["状态"],
          rows: [["在用"], ["option_1"], ["option_2"]],
        })[0],
        type,
      );
      const fields = [
        suggestObjectFields({ headers: ["名称"], rows: [["客户"]] })[0],
        { ...field, fieldKey: "col_2" },
      ];
      const result = buildFileObjectFields(fields, "col_1");
      const config = result.initialFields[1].config as {
        options: Array<{ key: string; label: string }>;
      };
      for (const option of config.options) {
        expect(coerceImportValue(type, option.label, config.options)).toEqual(
          type === "SINGLE_SELECT" ? option.key : [option.key],
        );
      }
    },
  );
  it("only sends included fields and sets the chosen title required", () => {
    const fields = suggestObjectFields({
      headers: ["名称", "数量", "备注"],
      rows: [["客户", "12", "说明"]],
    });
    fields[2].included = false;
    const result = buildFileObjectFields(fields, "col_1");
    expect(result.titleFieldKey).toBe("col_1");
    expect(result.initialFields).toHaveLength(2);
    expect(result.initialFields[0]).toMatchObject({
      fieldKey: "col_1",
      label: "名称",
      type: "TEXT",
      required: true,
      defaultValue: null,
    });
    expect(result.initialFields[1].required).toBe(false);
    expect(result.initialFields[0]).not.toHaveProperty("values");
  });
  it("requires a readable title and complete, nonduplicate select options", () => {
    const fields = suggestObjectFields({
      headers: ["名称", "状态"],
      rows: [["客户", "在用"]],
    });
    fields[1] = changeFileFieldType(fields[1], "SINGLE_SELECT");
    fields[1].optionText = "在用\n在用";
    expect(() => buildFileObjectFields(fields, "col_1")).toThrow(/选项重复/);
    fields[1].optionText = "";
    expect(() => buildFileObjectFields(fields, "col_1")).toThrow(/选项/);
    expect(() => buildFileObjectFields(fields, "missing")).toThrow(/标题/);
  });
  it("rejects overlong, too many options and duplicate labels without truncation", () => {
    const fields = suggestObjectFields({
      headers: ["名称", "状态"],
      rows: [["客户", "在用"]],
    });
    fields[1] = changeFileFieldType(fields[1], "SINGLE_SELECT");
    fields[1].optionText = "长".repeat(101);
    expect(() => buildFileObjectFields(fields, "col_1")).toThrow(/100/);
    fields[1].optionText = Array.from({ length: 101 }, (_, i) =>
      String(i),
    ).join("\n");
    expect(() => buildFileObjectFields(fields, "col_1")).toThrow(/100/);
    fields[1].label = "名称";
    expect(() => buildFileObjectFields(fields, "col_1")).toThrow(/名称重复/);
  });
});
