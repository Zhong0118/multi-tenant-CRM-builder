import { createHash, webcrypto } from "node:crypto";
import { beforeAll, describe, it, expect } from "vitest";
import type { PublishedFieldView } from "@/features/objects/object-types";
import { buildImportRows, SKIP } from "./record-import-mapping";
import { readImportFile } from "./record-import-file";
import {
  buildImportPreview,
  buildImportHeaderEvidence,
  emptyAssistDraft,
  applyImportAdvice,
} from "./record-import-assist";

beforeAll(() =>
  Object.defineProperty(globalThis.crypto, "subtle", {
    configurable: true,
    value: webcrypto.subtle,
  }),
);
const field = (
  fieldKey: string,
  label: string,
  type = "TEXT",
  access = "EDIT",
) =>
  ({
    fieldKey,
    label,
    type,
    access,
    config: { options: [{ key: "a", label: "A级" }] },
  }) as PublishedFieldView;
const fields = [
  field("name", "名称"),
  field("tier", "评级", "MULTI_SELECT"),
  field("private", "密薪", "TEXT", "READ_ONLY"),
  field("amount", "金额", "MONEY"),
];
async function preview(csv: string, excluded: number[] = []) {
  const file = await readImportFile(new File([csv], "test.csv"), "auto");
  const header = file.headerSelection("", fields);
  const parsed = file.sheet("", header.headerRow);
  const draft = emptyAssistDraft(parsed.headers, fields, false);
  return {
    parsed,
    draft,
    preview: buildImportPreview({
      headerEvidence: await buildImportHeaderEvidence(file, ""),
      file,
      sheet: "",
      headerRow: header.headerRow,
      headerLocked: true,
      fields,
      draft,
      excluded,
    }),
  };
}
describe("browser import assistance", () => {
  it("retains normalized evidence from every leading physical row for locked headers", async () => {
    const { preview: p } = await preview(
      "业务标题,机 密：\n名称,评级\n某客户,A类",
    );
    expect(
      p.request.headerEvidence.find((c) => c.col === "C2")?.hashes,
    ).toContain(createHash("sha256").update("机密").digest("hex"));
    expect(JSON.stringify(p.request)).not.toContain("机 密");
  });
  it("masks whole contacts before shortening, including in field labels", async () => {
    const { preview: p } = await preview(
      "联系电话,邮件,联系手机\n010-87654321,zhang.person@example.org,+86 138-1234-5678",
    );
    const text = JSON.stringify(p.request);
    expect(text).toContain("010-****4321");
    expect(text).toContain("z***@example.org");
    expect(text).toContain("138****5678");
    expect(text).not.toMatch(/87654321|zhang.person|1234-5678/);
  });
  it("keeps the entire evidence and request within 80KiB under maximum dictionary pressure", async () => {
    const headers = Array(40).fill("客户等级").join(",");
    const rows = Array.from({ length: 50 }, (_, r) =>
      Array(40)
        .fill(String(100000 + r))
        .join(","),
    );
    const { preview: p } = await preview([headers, ...rows].join("\n"));
    expect(
      new TextEncoder().encode(JSON.stringify(p.request)).length,
    ).toBeLessThanOrEqual(80 * 1024);
    expect(p.request.headerEvidence).toHaveLength(40);
    expect(p.partial).toBe(true);
    for (const c of p.request.candidates[0].columns)
      expect([undefined, 50]).toContain(c.values?.length);
  });
  it("makes a fully resolved sheet and a high-cardinality locked option column zero-call", async () => {
    expect((await preview("名称,评级\n私密名称,A级")).preview.needed).toBe(
      false,
    );
    const rows = Array.from({ length: 51 }, (_, i) => String(i));
    const p = (await preview(["评级", ...rows].join("\n"))).preview;
    expect(p.needed).toBe(false);
    expect(p.request.candidates[0].columns[0].values).toBeUndefined();
  });
  it("applies rule-determined dates through the shared row conversion entry", async () => {
    const f = field("date", "日期", "DATE");
    const rows = buildImportRows({
      parsed: { headers: ["日期"], rows: [["3/15/2024"]] },
      fields: [f],
      ...emptyAssistDraft(["日期"], [f], false),
      destination: () => ({ kind: "default" }),
    });
    expect(rows[0].values.date).toBe("2024-03-15");
  });
  it("only sends unresolved value IDs, keeps locked/owner/restricted columns private, and counts the whole file", async () => {
    const { preview: p } = await preview(
      "名称,评级,密薪,业务员,单位名称\n" +
        Array(7).fill("秘密公司,A级；A类,SECRET,绝密人名,某某客户").join("\n"),
      [4],
    );
    expect(JSON.stringify(p.request)).not.toMatch(
      /秘密公司|A级|密薪|SECRET|绝密人名|某某客户|单位名称/,
    );
    expect(p.request.candidates[0].columns[1]).toMatchObject({
      locked: { mode: "field", field: "tier" },
      samples: [],
      values: [{ text: "A类", count: 7 }],
    });
  });
  it("uses the same draft and row conversion for confirmed null, unresolved options and explicit units", async () => {
    const {
      parsed,
      draft,
      preview: p,
    } = await preview("评级,预算万元\nA级；A类,2\n未知,3元");
    const value = p.request.candidates[0].columns[0].values![0].id;
    const plan = {
      version: 1 as const,
      generatedAt: "",
      headerRow: 1,
      matchFields: [],
      columns: [
        {
          col: "C1",
          target: { mode: "field" as const, field: "tier" },
          confidence: "high" as const,
          reason: "",
          values: [{ value, option: null, confidence: "review" as const }],
        },
        {
          col: "C2",
          target: { mode: "field" as const, field: "amount" },
          confidence: "review" as const,
          reason: "",
          bareAmountUnit: "wan" as const,
        },
      ],
    };
    const high = applyImportAdvice(draft, p, plan, fields);
    expect(high.mapping[1]).toBe(SKIP);
    const adopted = applyImportAdvice(high, p, plan, fields, { column: "C2" });
    const decided = applyImportAdvice(adopted, p, plan, fields, {
      column: "C1",
      value,
    });
    const rows = buildImportRows({
      parsed,
      fields,
      ...decided,
      destination: () => ({ kind: "default" }),
    });
    expect(rows[0]).toMatchObject({ values: { tier: null, amount: "20000" } });
    expect(rows[1]).toMatchObject({
      values: { amount: "3" },
      error: { code: "RECORD_IMPORT_INVALID" },
    });
  });
});
