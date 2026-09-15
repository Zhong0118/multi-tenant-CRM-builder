import { expect, it } from "vitest";
import { actionLabel, resourceLabel } from "./audit-labels";
it("labels the lowercase dotted actions emitted by the API", () => {
  expect(actionLabel("platform.tenant.admin_phone_corrected")).toBe(
    "更正首位管理员手机号",
  );
  expect(actionLabel("membership.offboarded")).toBe("离职交接");
  expect(resourceLabel("tenant_invitation")).toBe("成员邀请");
});

it("labels every action the audit log was showing without a Chinese name", () => {
  // Each of these reached the platform audit log with no entry, so the table
  // rendered a half-translated label such as "dashboard.defaults updated" — or,
  // for a code with no underscores to replace, printed the same code twice.
  expect(actionLabel("dashboard.defaults_updated")).toBe("设置默认工作台");
  expect(actionLabel("dashboard.order_updated")).toBe("调整工作台顺序");
  expect(actionLabel("object.draft_deleted")).toBe("删除业务表草稿");
  expect(actionLabel("object.order_updated")).toBe("调整业务表顺序");
  expect(actionLabel("platform.admin.granted")).toBe("授予平台管理员");
  expect(actionLabel("record.activity_created")).toBe("新增记录跟进");
  expect(actionLabel("record.exported")).toBe("导出业务记录");
  expect(actionLabel("workflow.draft_updated")).toBe("更新流程配置");
  expect(actionLabel("record.workflow_started")).toBe("记录进入流程");
  expect(actionLabel("record.transition_executed")).toBe("执行流程动作");
});

it("passes an unlabelled action through instead of inventing a translation", () => {
  expect(actionLabel("object.never_seen_before")).toBe(
    "object.never_seen_before",
  );
});
