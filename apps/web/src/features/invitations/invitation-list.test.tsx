import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ GET: vi.fn() }));
vi.mock("@/lib/api/browser-client", () => ({ browserApiClient: api }));

import type { PersonalInvitation } from "./invitation-api";
import { InvitationList, spacedPhone } from "./invitation-list";

const invitation = {
  id: "inv-1",
  tenantName: "星云科技演示公司",
  role: "EMPLOYEE",
  status: "PENDING",
  inviterName: "刘洋",
  expiresAt: "2026-12-03T00:00:00.000Z",
} as unknown as PersonalInvitation;

afterEach(() => {
  vi.useRealTimers();
  api.GET.mockReset();
});

describe("InvitationList", () => {
  it("spaces a mainland number for reading aloud", () => {
    expect(spacedPhone("+8618800009301")).toBe("+86 188 0000 9301");
    expect(spacedPhone("+85261234567")).toBe("+85261234567");
  });

  it("shows the number to give the admin and copies it without +86", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<InvitationList phone="+8618800009301" initialInvitations={[]} />);
    expect(
      screen.getByRole("heading", { name: "等待公司邀请" }),
    ).toBeInTheDocument();
    expect(screen.getByText("+86 188 0000 9301")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("还没有收到");
    fireEvent.click(screen.getByRole("button", { name: /复\s*制/ }));
    await screen.findByRole("button", { name: /已复制/ });
    expect(writeText).toHaveBeenCalledWith("18800009301");
  });

  it("asks again on its own and shows an invitation when it arrives", async () => {
    vi.useFakeTimers();
    api.GET.mockResolvedValue({
      data: [invitation],
      response: new Response(null, { status: 200 }),
    });
    render(<InvitationList phone="+8618800009301" initialInvitations={[]} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(api.GET).toHaveBeenCalledWith("/api/v1/me/invitations");
    expect(
      screen.getByRole("heading", { name: "你收到了公司邀请" }),
    ).toBeInTheDocument();
    expect(screen.getByText("星云科技演示公司")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /查看邀请/ })).toHaveAttribute(
      "href",
      "/invitations/inv-1",
    );
    expect(screen.queryByText("+86 188 0000 9301")).not.toBeInTheDocument();
  });
});
