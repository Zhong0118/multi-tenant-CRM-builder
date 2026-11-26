import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { AccountEmail } from "./account-email";
import { EmailResetForm } from "./email-reset-form";
import { emailApi } from "./email-api";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));
// A sent code is remembered for the tab; each test starts with none.
beforeEach(() => window.sessionStorage.clear());
it("keeps email actions hidden when delivery is unavailable", () => {
  render(
    <AccountEmail
      status="VERIFIED"
      maskedEmail="z***@example.net"
      available={false}
      newDevice={true}
    />,
  );
  expect(screen.getByText("邮件服务暂未开通")).toBeVisible();
  expect(screen.queryByRole("button")).toBeNull();
});
it("requests re-verification without submitting the masked address", async () => {
  const request = vi
    .spyOn(emailApi, "challenge")
    .mockResolvedValue({ challengeId: "id", maskedEmail: "z***@example.net" });
  render(
    <AccountEmail
      status="UNDELIVERABLE"
      maskedEmail="z***@example.net"
      available
      newDevice={true}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "重新验证" }));
  fireEvent.click(screen.getByRole("button", { name: "发送验证码" }));
  await waitFor(() =>
    expect(request).toHaveBeenCalledWith({ purpose: "REVERIFY" }),
  );
  expect(await screen.findByLabelText("邮箱验证码")).toBeVisible();
  request.mockRestore();
});
it("shows the neutral recovery result and binds the code to the requested address", async () => {
  const send = vi
    .spyOn(emailApi, "forgot")
    .mockResolvedValue({
      challengeId: "opaque",
      message: "如果这个邮箱已绑定账号，你会收到验证码",
    });
  render(<EmailResetForm />);
  fireEvent.change(screen.getByLabelText("邮箱"), {
    target: { value: "sales@example.net" },
  });
  fireEvent.click(screen.getByRole("button", { name: "获取验证码" }));
  expect(
    await screen.findByText("如果这个邮箱已绑定账号，你会收到验证码"),
  ).toBeVisible();
  expect(screen.getByLabelText("邮箱")).toBeDisabled();
  send.mockRestore();
});

it("invalidates an issued verification challenge when the employee cancels", async () => {
  const send = vi
    .spyOn(emailApi, "challenge")
    .mockResolvedValue({
      challengeId: "temporary",
      maskedEmail: "s***@example.net",
    });
  const cancel = vi
    .spyOn(emailApi, "cancel")
    .mockResolvedValue({ accepted: true });
  render(
    <AccountEmail
      status="UNBOUND"
      maskedEmail={null}
      available
      newDevice={null}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "绑定邮箱" }));
  fireEvent.change(screen.getByLabelText("新邮箱"), {
    target: { value: "sales@example.net" },
  });
  fireEvent.click(screen.getByRole("button", { name: "发送验证码" }));
  await screen.findByLabelText("邮箱验证码");
  fireEvent.click(screen.getByRole("button", { name: /取 *消/ }));
  await waitFor(() => expect(cancel).toHaveBeenCalledWith("temporary"));
  await waitFor(() => expect(screen.queryByLabelText("邮箱验证码")).toBeNull());
  send.mockRestore();
  cancel.mockRestore();
});

it("brings back a sent code after the form was closed by a reload", async () => {
  const send = vi
    .spyOn(emailApi, "challenge")
    .mockResolvedValue({ challengeId: "kept", maskedEmail: "n***@example.net" });
  const view = render(
    <AccountEmail
      status="VERIFIED"
      maskedEmail="o***@example.net"
      available
      newDevice={true}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "换绑邮箱" }));
  expect(screen.getByText("当前 o***@example.net")).toBeVisible();
  fireEvent.change(screen.getByLabelText("新邮箱"), {
    target: { value: "new@example.net" },
  });
  fireEvent.change(screen.getByLabelText("当前密码"), {
    target: { value: "secret-1" },
  });
  fireEvent.click(screen.getByRole("button", { name: "发送验证码" }));
  await screen.findByLabelText("邮箱验证码");
  view.unmount();

  render(
    <AccountEmail
      status="VERIFIED"
      maskedEmail="o***@example.net"
      available
      newDevice={true}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "换绑邮箱" }));
  expect(screen.getByLabelText("邮箱验证码")).toBeVisible();
  expect(screen.getByLabelText("新邮箱")).toHaveValue("new@example.net");
  // The password is never kept.
  expect(screen.getByLabelText("当前密码")).toHaveValue("");
  expect(send).toHaveBeenCalledTimes(1);
  send.mockRestore();
});

it("names the new address once the change is verified", async () => {
  const send = vi
    .spyOn(emailApi, "challenge")
    .mockResolvedValue({ challengeId: "c1", maskedEmail: "n***@example.net" });
  const verify = vi
    .spyOn(emailApi, "verify")
    .mockResolvedValue({ accepted: true } as never);
  render(
    <AccountEmail
      status="VERIFIED"
      maskedEmail="o***@example.net"
      available
      newDevice={true}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "换绑邮箱" }));
  fireEvent.change(screen.getByLabelText("新邮箱"), {
    target: { value: "new@example.net" },
  });
  fireEvent.change(screen.getByLabelText("当前密码"), {
    target: { value: "secret-1" },
  });
  fireEvent.click(screen.getByRole("button", { name: "发送验证码" }));
  fireEvent.change(await screen.findByLabelText("邮箱验证码"), {
    target: { value: "123456" },
  });
  fireEvent.click(screen.getByRole("button", { name: "完成验证" }));
  expect(
    await screen.findByText("邮箱已换成 new@example.net"),
  ).toBeVisible();
  expect(window.sessionStorage.getItem("crm:email-challenge")).toBeNull();
  send.mockRestore();
  verify.mockRestore();
});

it("explains the sending limits instead of a bare 稍后再试", async () => {
  const send = vi.spyOn(emailApi, "challenge").mockRejectedValue({
    code: "RATE_LIMITED",
    message: "操作过于频繁，请稍后再试。",
    requestId: "req",
    status: 429,
  });
  render(
    <AccountEmail
      status="UNBOUND"
      maskedEmail={null}
      available
      newDevice={null}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "绑定邮箱" }));
  fireEvent.change(screen.getByLabelText("新邮箱"), {
    target: { value: "sales@example.net" },
  });
  fireEvent.click(screen.getByRole("button", { name: "发送验证码" }));
  expect(await screen.findByText(/每分钟只能发 1 次，每小时最多 5 次/)).toBeVisible();
  send.mockRestore();
});
