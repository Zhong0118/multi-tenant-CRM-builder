import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import {
  BulkMemberAccess,
  type MemberBatchAccessApi,
} from "./bulk-member-access";
import type { TenantMember } from "./member-table";
import type { MemberObjectAccessRow } from "./member-object-access";

const members: TenantMember[] = ["张三", "李四", "管理员", "停用"].map(
  (displayName, index) => ({
    id: `member-${index}`,
    userId: `user-${index}`,
    tenantId: "tenant",
    displayName,
    phone: undefined,
    role: index === 2 ? "TENANT_ADMIN" : "EMPLOYEE",
    status: index === 3 ? "DISABLED" : "ACTIVE",
  }),
);
const policy = {
  canCreate: true,
  canRead: true,
  canUpdate: true,
  canDelete: false,
  readScope: "OWN",
  updateScope: "OWN",
} as const;
const objects: MemberObjectAccessRow[] = [
  {
    objectId: "customers",
    objectCode: "customers",
    objectName: "客户",
    mode: "INHERIT",
    inherited: policy,
    effective: policy,
    override: null,
    fields: [
      {
        fieldId: "amount",
        fieldKey: "amount",
        label: "金额",
        isSystem: false,
        inherited: "HIDDEN",
        effective: "HIDDEN",
        override: null,
      },
      {
        fieldId: "name",
        fieldKey: "name",
        label: "姓名",
        isSystem: false,
        inherited: "EDIT",
        effective: "EDIT",
        override: null,
      },
      {
        fieldId: "created",
        fieldKey: "createdAt",
        label: "创建时间",
        isSystem: true,
        inherited: "READ_ONLY",
        effective: "READ_ONLY",
        override: null,
      },
    ],
  },
];
async function choose(label: string, option: string) {
  await waitFor(() => expect(screen.getByLabelText(label)).toBeEnabled());
  fireEvent.mouseDown(screen.getByLabelText(label));
  fireEvent.click(
    await screen.findByText(option, {
      selector: ".ant-select-item-option-content",
    }),
  );
}
function setup(
  overrides: Partial<MemberBatchAccessApi> = {},
  selected = members,
) {
  const api = {
    list: vi.fn().mockResolvedValue(objects),
    set: vi.fn().mockResolvedValue({ updated: 2 }),
    ...overrides,
  };
  const onChanged = vi.fn();
  render(
    <BulkMemberAccess
      tenantCode="acme"
      selected={selected}
      api={api}
      onChanged={onChanged}
    />,
  );
  return { api, onChanged };
}
it("applies only changed columns to selected active employees and keeps existing object policy", async () => {
  const { api, onChanged } = setup();
  fireEvent.click(
    screen.getByRole("button", { name: "批量设置访问权限（2 人）" }),
  );
  await choose("业务表", "客户");
  expect(
    screen.getByRole("button", { name: /保存并应用到 2 人/ }),
  ).toBeDisabled();
  expect(screen.queryByLabelText("创建时间权限")).not.toBeInTheDocument();
  await choose("金额权限", "可编辑");
  fireEvent.click(screen.getByRole("button", { name: /保存并应用到 2 人/ }));
  await waitFor(() =>
    expect(api.set).toHaveBeenCalledWith("acme", "customers", {
      memberIds: ["member-0", "member-1"],
      fields: [{ fieldId: "amount", access: "EDIT" }],
    }),
  );
  await waitFor(() => expect(onChanged).toHaveBeenCalledOnce());
});
it("retains failed drafts and retries restoring field defaults without touching object permissions", async () => {
  const set = vi
    .fn()
    .mockRejectedValueOnce({
      code: "SERVICE_UNAVAILABLE",
      message: "保存失败",
      fieldErrors: {},
      status: 503,
      requestId: "req_save",
    })
    .mockResolvedValue({ updated: 2 });
  const { onChanged } = setup({ set });
  fireEvent.click(
    screen.getByRole("button", { name: "批量设置访问权限（2 人）" }),
  );
  await choose("业务表", "客户");
  await choose("金额权限", "跟随默认");
  fireEvent.click(screen.getByRole("button", { name: /保存并应用到 2 人/ }));
  await screen.findByText(/保存失败/);
  expect(onChanged).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: /保存并应用到 2 人/ }));
  await waitFor(() => expect(onChanged).toHaveBeenCalledOnce());
  expect(set.mock.calls.map((call) => call[2])).toEqual([
    {
      memberIds: ["member-0", "member-1"],
      fields: [{ fieldId: "amount", access: "INHERIT" }],
    },
    {
      memberIds: ["member-0", "member-1"],
      fields: [{ fieldId: "amount", access: "INHERIT" }],
    },
  ]);
});
it("disables the entry when only administrators and disabled employees are selected", () => {
  setup({}, members.slice(2));
  expect(
    screen.getByRole("button", { name: "批量设置访问权限（0 人）" }),
  ).toBeDisabled();
});
it("restores only the object policy when no column is selected", async () => {
  const { api } = setup();
  fireEvent.click(
    screen.getByRole("button", { name: "批量设置访问权限（2 人）" }),
  );
  await choose("业务表", "客户");
  await choose("表权限", "跟随默认");
  fireEvent.click(screen.getByRole("button", { name: /保存并应用到 2 人/ }));
  await waitFor(() =>
    expect(api.set).toHaveBeenCalledWith("acme", "customers", {
      memberIds: ["member-0", "member-1"],
      objectAccess: { mode: "INHERIT" },
    }),
  );
});
it("submits the complete custom object policy and locks the draft until the batch finishes", async () => {
  let finish!: (result: { updated: number }) => void;
  const set = vi.fn(
    () =>
      new Promise<{ updated: number }>((resolve) => {
        finish = resolve;
      }),
  );
  setup({ set });
  fireEvent.click(
    screen.getByRole("button", { name: "批量设置访问权限（2 人）" }),
  );
  await choose("业务表", "客户");
  await choose("表权限", "自定义完整策略");
  fireEvent.click(screen.getByLabelText("可以新建记录"));
  fireEvent.click(screen.getByRole("button", { name: /保存并应用到 2 人/ }));
  await waitFor(() =>
    expect(set).toHaveBeenCalledWith("acme", "customers", {
      memberIds: ["member-0", "member-1"],
      objectAccess: {
        mode: "OVERRIDE",
        canCreate: false,
        canRead: true,
        canUpdate: true,
        readScope: "OWN",
        updateScope: "OWN",
      },
    }),
  );
  expect(screen.getByLabelText("业务表")).toBeDisabled();
  expect(screen.getByLabelText("金额权限")).toBeDisabled();
  expect(screen.getByRole("button", { name: /取\s*消/ })).toBeDisabled();
  finish({ updated: 2 });
  await screen.findByText(/已更新 2 位员工/);
});
