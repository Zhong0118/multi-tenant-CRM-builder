import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { LogoutButton } from "./logout-button";

const mocks = vi.hoisted(() => ({
  post: vi.fn(),
  refresh: vi.fn(),
  replace: vi.fn(),
  showError: vi.fn(),
}));

vi.mock("antd", async (importOriginal) => {
  const actual = await importOriginal<typeof import("antd")>();
  return { ...actual, message: { ...actual.message, error: mocks.showError } };
});

vi.mock("@/lib/api/browser-client", () => ({
  browserApiClient: { POST: mocks.post },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh, replace: mocks.replace }),
}));

describe("LogoutButton", () => {
  it("recovers from a network failure so the user can retry", async () => {
    mocks.post.mockRejectedValueOnce(new Error("network unavailable"));
    render(<LogoutButton />);
    const button = screen.getByRole("button", { name: /退出登录/ });

    fireEvent.click(button);

    await waitFor(() =>
      expect(mocks.showError).toHaveBeenCalledWith("退出失败，请稍后重试。"),
    );
    expect(button).not.toBeDisabled();
    expect(mocks.replace).not.toHaveBeenCalled();
  });
});
