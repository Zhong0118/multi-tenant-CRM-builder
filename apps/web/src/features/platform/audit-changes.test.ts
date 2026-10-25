import { describe, expect, it } from "vitest";

import { auditChanges, auditOutcome, formatAuditValue } from "./audit-changes";

describe("audit changes", () => {
  it("lists only changed fields, labelled ones first, with readable values", () => {
    const changes = auditChanges(
      { status: "DRAFT", customFlag: 1, name: "星云" },
      {
        status: "ACTIVE",
        customFlag: 2,
        name: "星云",
        activatedAt: "2026-10-25T02:05:00.000Z",
      },
      "TENANT",
    );
    expect(changes.map((change) => change.key)).toEqual([
      "status",
      "activatedAt",
      "customFlag",
    ]);
    expect(changes[0]).toMatchObject({
      label: "状态",
      before: "草稿",
      after: "运行中",
    });
    expect(changes[1]).toMatchObject({
      label: "启用时间",
      before: "—",
      after: "2026-10-25 10:05",
    });
    // Unlabelled keys keep their code rather than disappearing.
    expect(changes[2]).toMatchObject({
      label: "customFlag",
      before: "1",
      after: "2",
    });
  });

  it("marks the missing side of a creation or a removal", () => {
    expect(auditChanges(null, { role: "EMPLOYEE" }, "tenant_member")).toEqual([
      { key: "role", label: "角色", before: "—", after: "员工" },
    ]);
    expect(auditChanges({ title: "回访" }, null, "work_task")[0]).toMatchObject(
      { before: "回访", after: "—" },
    );
  });

  it("summarises a status change as the outcome", () => {
    expect(
      auditOutcome(
        { status: "PENDING" },
        { status: "REVOKED" },
        "TENANT_INVITATION",
      ),
    ).toBe("待接受 → 已撤销");
    expect(
      auditOutcome({ status: "ACTIVE" }, { status: "ACTIVE" }, "tenant"),
    ).toBeNull();
    expect(auditOutcome(null, { status: "ACTIVE" }, "tenant")).toBeNull();
  });

  it("formats identifiers, booleans, lists and long objects", () => {
    expect(
      formatAuditValue("01a12ec3-1743-71b5-882f-15641cb19edd", "recordId", "x"),
    ).toBe("01a12ec3…");
    expect(formatAuditValue(true, "enabled", "x")).toBe("是");
    expect(formatAuditValue(["a", "b"], "tags", "x")).toBe("a、b");
    expect(
      formatAuditValue({ text: "x".repeat(200) }, "payload", "x"),
    ).toHaveLength(118);
    expect(formatAuditValue("", "notes", "x")).toBe("—");
  });
});
