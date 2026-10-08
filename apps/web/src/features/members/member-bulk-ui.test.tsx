import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { BulkInviteMembers } from "./bulk-invite-members";
import { BulkMemberActions, MemberNameEditor } from "./member-edit-actions";
import type { MemberApi, TenantMember } from "./member-table";

const members: TenantMember[] = ["张三", "李四"].map((displayName, index) => ({
  id: `member-${index}`,
  userId: `user-${index}`,
  tenantId: "tenant",
  displayName,
  phone: `+861380013800${index}`,
  role: "EMPLOYEE",
  status: "ACTIVE",
}));

it("previews imports, prevents invalid submissions and retries only failed invitations", async () => {
  const invite = vi
    .fn()
    .mockResolvedValueOnce({})
    .mockRejectedValueOnce(new Error("已有邀请"))
    .mockResolvedValueOnce({});
  const api = { invite } as unknown as MemberApi;
  render(<BulkInviteMembers tenantCode="acme" api={api} onChanged={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "批量邀请" }));
  fireEvent.change(screen.getByLabelText("成员名单"), {
    target: { value: "姓名,手机号\n张三,123" },
  });
  fireEvent.click(screen.getByRole("button", { name: "校验并预览" }));
  expect(screen.getByRole("button", { name: "确认邀请 1 人" })).toBeDisabled();
  fireEvent.change(screen.getByLabelText("成员名单"), {
    target: { value: "姓名,手机号\n张三,13800138000\n李四,13900139000" },
  });
  fireEvent.click(screen.getByRole("button", { name: "校验并预览" }));
  fireEvent.click(screen.getByRole("button", { name: "确认邀请 2 人" }));
  await screen.findByText("已有邀请");
  expect(invite).toHaveBeenCalledTimes(2);
  expect(invite).toHaveBeenNthCalledWith(1, "acme", {
    displayName: "张三",
    phone: "+8613800138000",
    role: "EMPLOYEE",
  });
  await waitFor(() =>
    expect(screen.getByRole("button", { name: /重试失败行/ })).not.toHaveClass(
      "ant-btn-loading",
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: /重试失败行/ }));
  await waitFor(() => expect(invite).toHaveBeenCalledTimes(3));
  expect(invite.mock.calls[2][1].displayName).toBe("李四");
});

it("locks a running batch and preserves the action and per-row results on retry", async () => {
  let release!: () => void;
  const action = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    )
    .mockRejectedValueOnce(new Error("请先交接"))
    .mockResolvedValueOnce(undefined);
  render(
    <BulkMemberActions
      tenantCode="acme"
      selected={members}
      onChanged={vi.fn()}
      api={{ action, name: vi.fn() }}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /批量管理/ }));
  fireEvent.click(screen.getByRole("button", { name: "确认执行" }));
  expect(screen.getByLabelText("批量操作")).toBeDisabled();
  expect(screen.getByRole("button", { name: /关\s*闭/ })).toBeDisabled();
  release();
  await screen.findByText("请先交接");
  await waitFor(() =>
    expect(screen.getByRole("button", { name: /重试失败行/ })).not.toHaveClass(
      "ant-btn-loading",
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: /重试失败行/ }));
  await waitFor(() => expect(action).toHaveBeenCalledTimes(3));
  expect(action.mock.calls.map((call) => call.slice(1))).toEqual([
    ["member-0", "EMPLOYEE"],
    ["member-1", "EMPLOYEE"],
    ["member-1", "EMPLOYEE"],
  ]);
});

it("saves a trimmed company name without changing phone or account fields", async () => {
  const name = vi.fn().mockResolvedValue(undefined);
  render(
    <MemberNameEditor
      tenantCode="acme"
      member={members[0]}
      onChanged={vi.fn()}
      api={{ name, action: vi.fn() }}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "修改姓名 张三" }));
  fireEvent.change(screen.getByLabelText("公司内姓名"), {
    target: { value: "  业务张三  " },
  });
  fireEvent.click(screen.getByRole("button", { name: /保\s*存/ }));
  await waitFor(() =>
    expect(name).toHaveBeenCalledWith("acme", "member-0", "业务张三"),
  );
});
