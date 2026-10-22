import { describe, expect, it } from "vitest";

import type { PlatformTenant } from "./create-tenant-form";
import { tenantConfigurationText, tenantNextStep } from "./tenant-next-step";

function active(
  tables: Partial<NonNullable<PlatformTenant["configuration"]>["tables"]>,
  template: NonNullable<PlatformTenant["configuration"]>["template"] = null,
): PlatformTenant {
  return {
    id: "t",
    name: "公司",
    code: "c",
    status: "ACTIVE",
    activeAdminCount: 1,
    configuration: {
      tables: {
        total: 0,
        draft: 0,
        published: 0,
        pendingChanges: 0,
        archived: 0,
        ...tables,
      },
      template,
    },
  };
}

const template = {
  name: "标准 CRM",
  versionNo: 2,
  appliedAt: "2026-10-01T00:00:00.000Z",
};

describe("tenantNextStep for an active company", () => {
  it.each([
    [active({}), "尚未初始化 · 可应用模板，或由公司管理员搭建业务表"],
    [
      active({ total: 3, draft: 3 }, template),
      "模板已复制为草稿 · 等公司管理员检查并发布",
    ],
    [active({ total: 2, draft: 2 }), "业务表都是草稿 · 等公司管理员发布"],
    [
      active({ total: 3, published: 3, pendingChanges: 1 }),
      "1 张表有未发布的修改 · 由公司管理员发布",
    ],
    [
      active({ total: 3, published: 2, archived: 1 }),
      "已在使用 · 由公司管理员维护业务表和员工",
    ],
  ])("says who acts next", (tenant, expected) => {
    expect(tenantNextStep(tenant)).toBe(expected);
  });
});

describe("tenantConfigurationText", () => {
  it("distinguishes uninitialized, draft, published, pending and stopped tables with provenance", () => {
    expect(tenantConfigurationText(active({}))).toEqual({
      summary: "未初始化",
    });
    expect(
      tenantConfigurationText(
        active(
          { total: 5, published: 3, pendingChanges: 1, draft: 1, archived: 1 },
          template,
        ),
      ),
    ).toEqual({
      summary: "已发布 3 · 其中待发布修改 1 · 草稿 1 · 已停用 1",
      provenance: "模板「标准 CRM」v2",
    });
  });
});
