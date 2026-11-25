import { render, screen, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { PlatformMail } from "./platform-mail";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
it("keeps ambiguous deliveries separate from failures and uses the message category name", () => {
  render(
    <PlatformMail
      ready
      verified={false}
      items={[
        { kind: "code_reset", status: "sent", count: 2 },
        { kind: "code_reset", status: "unknown", count: 1 },
      ]}
    />,
  );
  expect(screen.getByRole("button", { name: "发送测试邮件" })).toBeDisabled();
  const row = screen.getByRole("row", { name: /邮箱找回/ });
  expect(
    within(row)
      .getAllByRole("cell")
      .map((c) => c.textContent),
  ).toEqual(["邮箱找回", "2", "0", "1"]);
});
it("hides the send action when SMTP is disabled", () => {
  render(<PlatformMail ready={false} verified items={[]} />);
  expect(screen.queryByRole("button", { name: "发送测试邮件" })).toBeNull();
  expect(screen.getByText("最近 7 天还没有邮件发送记录")).toBeVisible();
});
