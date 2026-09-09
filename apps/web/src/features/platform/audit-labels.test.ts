import { expect, it } from "vitest";
import { actionLabel, resourceLabel } from "./audit-labels";
it("labels the lowercase dotted actions emitted by the API", () => {
  expect(actionLabel("platform.tenant.admin_phone_corrected")).toBe(
    "更正首位管理员手机号",
  );
  expect(actionLabel("membership.offboarded")).toBe("离职交接");
  expect(resourceLabel("tenant_invitation")).toBe("成员邀请");
});
