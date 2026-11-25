import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { it, expect, vi } from "vitest";
import { AccountProfile } from "./account-profile";
const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
it("saves jobs independently and preserves input on failed account edits", async () => {
  const api = {
    name: vi
      .fn()
      .mockRejectedValueOnce({
        message: "请重试",
        status: 503,
        requestId: "r",
        code: "BUSY",
      })
      .mockResolvedValue({}),
    title: vi.fn().mockResolvedValue({}),
  };
  const memberships = ["甲公司", "乙公司"].map((tenantName, i) => ({
    memberId: String(i),
    tenantId: String(i),
    tenantCode: String(i),
    tenantName,
    role: "EMPLOYEE" as const,
    memberDisplayName: null,
    displayName: "李明",
    jobTitle: null,
    employeeNo: null,
  }));
  render(
    <AccountProfile
      name="李明"
      avatarUrl={null}
      memberships={memberships}
      api={api}
    />,
  );
  fireEvent.change(screen.getByLabelText("甲公司职位"), {
    target: { value: "  销售  " },
  });
  fireEvent.click(screen.getByRole("button", { name: "保存甲公司职位" }));
  await waitFor(() => expect(api.title).toHaveBeenCalledWith("0", "销售"));
  expect(screen.getByLabelText("乙公司职位")).toHaveValue("");
  fireEvent.change(screen.getByLabelText("账号姓名"), {
    target: { value: "李华" },
  });
  fireEvent.click(screen.getByRole("button", { name: "保存账号姓名" }));
  await screen.findByText("请重试");
  expect(screen.getByLabelText("账号姓名")).toHaveValue("李华");
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "保存账号姓名" }),
    ).not.toHaveClass("ant-btn-loading"),
  );
  fireEvent.click(screen.getByRole("button", { name: "保存账号姓名" }));
  await waitFor(() => expect(api.name).toHaveBeenCalledTimes(2));
});
