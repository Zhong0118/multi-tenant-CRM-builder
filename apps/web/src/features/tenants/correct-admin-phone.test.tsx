import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/api/browser-client", () => ({
  browserApiClient: { PATCH: vi.fn().mockResolvedValue({ data: { id: "a" } }) },
}));
import { browserApiClient } from "@/lib/api/browser-client";
import { CorrectAdminPhone } from "./correct-admin-phone";
it("submits the corrected phone to the scoped tenant endpoint and confirms invalidation", async () => {
  render(<CorrectAdminPhone tenantId="a" />);
  fireEvent.change(screen.getByLabelText("正确的管理员手机号"), {
    target: { value: "13900139000" },
  });
  fireEvent.click(screen.getByRole("button", { name: "更正手机号并重新邀请" }));
  await waitFor(() =>
    expect(
      screen.getByText("手机号已更正，原邀请已失效。"),
    ).toBeInTheDocument(),
  );
  expect(browserApiClient.PATCH).toHaveBeenCalledWith(
    "/api/v1/platform/tenants/{tenantId}/first-admin-phone",
    {
      params: { path: { tenantId: "a" } },
      body: { firstAdminPhone: "13900139000" },
    },
  );
});
