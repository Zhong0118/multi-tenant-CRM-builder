import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  SessionList,
  type SecurityApi,
  type SecuritySession,
} from "./session-list";

const sessions: SecuritySession[] = [
  {
    id: "current-session",
    deviceSummary: "Chrome · macOS",
    ipSummary: "203.0.113.10",
    isCurrent: true,
    createdAt: "2026-08-20T08:00:00.000Z",
    lastUsedAt: "2026-08-20T10:00:00.000Z",
    expiresAt: "2026-09-20T08:00:00.000Z",
  },
  {
    id: "other-session",
    deviceSummary: "Safari · iPhone",
    ipSummary: "203.0.113.11",
    isCurrent: false,
    createdAt: "2026-08-19T08:00:00.000Z",
    lastUsedAt: "2026-08-19T10:00:00.000Z",
    expiresAt: "2026-09-19T08:00:00.000Z",
  },
];

function renderSecurity(api: SecurityApi) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { mutations: { retry: false } },
        })
      }
    >
      <SessionList initialSessions={sessions} api={api} />
    </QueryClientProvider>,
  );
}

describe("SessionList", () => {
  it("marks the current session and revokes only another session after confirmation", async () => {
    const api: SecurityApi = {
      revokeSession: vi.fn().mockResolvedValue({ accepted: true }),
      changePassword: vi.fn(),
    };
    renderSecurity(api);

    expect(screen.getByText("当前会话")).toBeInTheDocument();
    expect(screen.getByText("203.0.113.10")).toBeInTheDocument();
    expect(screen.getByText("203.0.113.11")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /撤\s*销/ })).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: /撤\s*销/ }));
    fireEvent.click(await screen.findByRole("button", { name: "确认撤销" }));

    await waitFor(() =>
      expect(api.revokeSession).toHaveBeenCalledWith("other-session"),
    );
    await waitFor(() =>
      expect(screen.queryByText("Safari · iPhone")).not.toBeInTheDocument(),
    );
  });

  it("changes the password and keeps the current session", async () => {
    const api: SecurityApi = {
      revokeSession: vi.fn(),
      changePassword: vi.fn().mockResolvedValue({ accepted: true }),
    };
    renderSecurity(api);

    fireEvent.change(screen.getByLabelText("当前密码"), {
      target: { value: "current-password" },
    });
    fireEvent.change(screen.getByLabelText("新密码"), {
      target: { value: "new-password1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "更新密码" }));

    await waitFor(() =>
      expect(api.changePassword).toHaveBeenCalledWith({
        currentPassword: "current-password",
        newPassword: "new-password1",
      }),
    );
    expect(
      await screen.findByText("密码已更新，其他设备的会话已撤销。"),
    ).toBeInTheDocument();
    expect(screen.getByText("当前会话")).toBeInTheDocument();
  });
});
