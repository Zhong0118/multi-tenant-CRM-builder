import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { LogoutButton } from "./logout-button";

const mocks = vi.hoisted(() => ({
  post: vi.fn(),
  refresh: vi.fn(),
  replace: vi.fn(),
}));

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

    await waitFor(() => expect(button).not.toBeDisabled());
    expect(mocks.replace).not.toHaveBeenCalled();
  });
});
