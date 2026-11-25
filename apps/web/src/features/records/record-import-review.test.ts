import type { ImportAssistPlan } from "@crm/contracts";
import { expect, it } from "vitest";
import { readImportFile } from "./record-import-file";
import type { PublishedFieldView } from "@/features/objects/object-types";
import {
  applyImportAdvice,
  buildImportPreview,
  emptyAssistDraft,
  reviewImportPlan,
  remainingImportValues,
  setRemainingImportValues,
} from "./record-import-assist";
import { SKIP } from "./record-import-mapping";
import { coerceImportValue } from "./record-csv";

const tier = {
  fieldKey: "tier",
  label: "等级",
  type: "MULTI_SELECT",
  access: "EDIT",
  required: true,
  config: { options: [{ key: "a", label: "A级", status: "ACTIVE" }] },
} as PublishedFieldView;
it("leaves only unresolved values blank across every page and undoes the batch without erasing choices", () => {
  const rows = [
    ["A级；手选"],
    ["原空"],
    ["未定0；未定1；A级"],
    ["N/A"],
    ...Array.from({ length: 56 }, (_, i) => ["未定" + i]),
  ];
  const before = new Map<string, string | null>([
    ["手选", "a"],
    ["原空", null],
  ]);
  const { values, rowCount } = remainingImportValues(rows, 0, tier, before);
  expect(values).toHaveLength(56);
  expect(rowCount).toBe(57);
  const blank = setRemainingImportValues(before, values);
  expect(blank.get("未定55")).toBe(null);
  expect(blank.has("A级")).toBe(false);
  expect(
    coerceImportValue(tier.type, rows[2][0], [{ key: "a", label: "A级" }], {
      valueChoices: blank,
    }),
  ).toBe(null);
  blank.set("未定55", "a");
  expect(setRemainingImportValues(blank, values, true)).toEqual(
    new Map([...before, ["未定55", "a"]]),
  );
});

it("offers a mixed multi-select token while skipping a standalone null marker", () => {
  const pending = remainingImportValues(
    [["N/A"], ["A级；N/A；N/A"], ["#REF!"]],
    0,
    tier,
  );
  expect(pending.entries).toEqual([["N/A", 1]]);
  expect(pending.values).toEqual(["N/A"]);
  expect(pending.rowCount).toBe(1);
});

it.each([
  ["DATE", "2026年11月3日", "日期"],
  ["DATETIME", "2026-11-03T11:45:02+08:00", "日期时间"],
  ["MONEY", "￥3,210.50", "金额"],
  ["NUMBER", "1.2e3", "数值"],
] as const)(
  "checks the manually selected header's %s columns before showing or applying a high suggestion",
  async (type, value, label) => {
    const fields = [
      { ...tier, fieldKey: "first", label: "首项", type },
      { ...tier, fieldKey: "second", label: "次项", type },
    ];
    const file = await readImportFile(
      new File(
        [
          [
            "清单,标题",
            "报价,金额列",
            ...Array(8).fill("不详,未填"),
            '"' + value + '","' + value + '"',
          ].join("\n"),
        ],
        "cols.csv",
      ),
      "auto",
    );
    const draft = emptyAssistDraft(file.sheet("", 2).headers, fields, false);
    const preview = buildImportPreview({
      file,
      sheet: "",
      fields,
      draft,
      headerEvidence: [],
      headerRow: 2,
    });
    const base = draft;
    const raw: ImportAssistPlan = {
      version: 1,
      generatedAt: "",
      matchFields: [],
      columns: ["first", "second"].map((field, i) => ({
        col: "C" + (i + 1),
        target: { mode: "field", field },
        confidence: "high",
        reason: "建议人工核对",
      })),
    };
    const review = reviewImportPlan(
      raw,
      preview,
      file,
      "",
      fields,
      "Asia/Shanghai",
    );
    expect(review.columns.map((c) => [c.confidence, c.reason])).toEqual(
      Array(2).fill(["review", "文件中还有其他" + label + "列，请确认"]),
    );
    expect(applyImportAdvice(base, preview, review, fields).mapping).toEqual([
      SKIP,
      SKIP,
    ]);
    expect(
      applyImportAdvice(base, preview, review, fields, { column: "C1" })
        .mapping,
    ).toEqual(["first", SKIP]);
    expect(raw.columns[0].confidence).toBe("high");
    draft.manual = [1];
    const locked = buildImportPreview({
      file,
      sheet: "",
      fields,
      draft,
      headerEvidence: [],
      headerRow: 1,
    });
    expect(
      reviewImportPlan(raw, locked, file, "", fields, "Asia/Shanghai")
        .columns[0].confidence,
    ).toBe("high");
  },
);
