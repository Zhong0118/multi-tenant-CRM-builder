import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { AccountEmail } from "./account-email";
import { EmailResetForm } from "./email-reset-form";
import { emailApi } from "./email-api";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));
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
