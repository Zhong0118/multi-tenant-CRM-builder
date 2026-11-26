import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { AuthApi } from "./auth-api";
import { PasswordResetForm } from "./password-reset-form";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

describe("PasswordResetForm", () => {
  it("requests a reset code, changes the password, and returns to login", async () => {
    const api: AuthApi = {
      requestRegisterCode: vi.fn(),
      register: vi.fn(),
      login: vi.fn(),
      requestPasswordResetCode: vi.fn().mockResolvedValue({ accepted: true }),
      resetPassword: vi.fn().mockResolvedValue({ accepted: true }),
      listWorkspaces: vi.fn(),
    };
    const navigate = vi.fn();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <PasswordResetForm
          api={api}
          navigate={navigate}
          device={{ key: "device-test", summary: "Vitest browser" }}
        />
      </QueryClientProvider>,
    );

    fireEvent.change(screen.getByLabelText("手机号"), {
      target: { value: "13800138000" },
    });
    fireEvent.click(screen.getByRole("button", { name: "获取验证码" }));
    await waitFor(() =>
      expect(api.requestPasswordResetCode).toHaveBeenCalledWith({
        phone: "13800138000",
        deviceKey: "device-test",
      }),
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "验证码已发送至 13800138000",
    );

    fireEvent.change(screen.getByLabelText("验证码"), {
      target: { value: "123456" },
    });
    fireEvent.change(screen.getByLabelText("设置新密码"), {
      target: { value: "new-password1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "重置密码" }));

    await waitFor(() =>
      expect(screen.getByText("密码已重置")).toBeInTheDocument(),
    );
    expect(api.resetPassword).toHaveBeenCalledWith({
      phone: "13800138000",
      code: "123456",
      newPassword: "new-password1",
    });
    expect(navigate).toHaveBeenCalledWith("/login?reset=done");
  });

  it("offers an explicit password visibility control", () => {
    const api: AuthApi = {
      requestRegisterCode: vi.fn(),
      register: vi.fn(),
      login: vi.fn(),
      requestPasswordResetCode: vi.fn(),
      resetPassword: vi.fn(),
      listWorkspaces: vi.fn(),
    };
    render(
      <QueryClientProvider client={new QueryClient()}>
        <PasswordResetForm
          api={api}
          device={{ key: "device-test", summary: "Vitest browser" }}
        />
      </QueryClientProvider>,
    );

    const password = screen.getByLabelText("设置新密码");
    fireEvent.click(screen.getByRole("button", { name: "显示密码" }));
    expect(password).toHaveAttribute("type", "text");
  });

  it("invalidates the reset code when the phone number changes", async () => {
    const api: AuthApi = {
      requestRegisterCode: vi.fn(),
      register: vi.fn(),
      login: vi.fn(),
      requestPasswordResetCode: vi.fn().mockResolvedValue({ accepted: true }),
      resetPassword: vi.fn(),
      listWorkspaces: vi.fn(),
    };
    render(
      <QueryClientProvider client={new QueryClient()}>
        <PasswordResetForm
          api={api}
          device={{ key: "device-test", summary: "Vitest browser" }}
        />
      </QueryClientProvider>,
    );

    fireEvent.change(screen.getByLabelText("手机号"), {
      target: { value: "13800138000" },
    });
    fireEvent.click(screen.getByRole("button", { name: "获取验证码" }));
    await waitFor(() =>
      expect(api.requestPasswordResetCode).toHaveBeenCalledOnce(),
    );
    fireEvent.change(screen.getByLabelText("验证码"), {
      target: { value: "123456" },
    });
    fireEvent.change(screen.getByLabelText("设置新密码"), {
      target: { value: "new-password1" },
    });
    fireEvent.change(screen.getByLabelText("手机号"), {
      target: { value: "13900139000" },
    });

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "获取验证码" })).toBeEnabled(),
    );
    expect(screen.getByLabelText("验证码")).toHaveValue("");
    fireEvent.click(screen.getByRole("button", { name: "重置密码" }));
    expect(
      await screen.findByText("请先获取这个手机号的验证码。"),
    ).toBeInTheDocument();
    expect(api.resetPassword).not.toHaveBeenCalled();
  });

  it("keeps a sent code usable after the page reloads", async () => {
    const api: AuthApi = {
      requestRegisterCode: vi.fn(),
      register: vi.fn(),
      login: vi.fn(),
      requestPasswordResetCode: vi.fn().mockResolvedValue({ accepted: true }),
      resetPassword: vi.fn().mockResolvedValue({}),
      listWorkspaces: vi.fn(),
    };
    const navigate = vi.fn();
    const form = () => (
      <QueryClientProvider client={new QueryClient()}>
        <PasswordResetForm
          api={api}
          navigate={navigate}
          returnTo="/account/security"
          device={{ key: "device-test", summary: "Vitest browser" }}
        />
      </QueryClientProvider>
    );
    const first = render(form());
    fireEvent.change(screen.getByLabelText("手机号"), {
      target: { value: "13800138000" },
    });
    fireEvent.click(screen.getByRole("button", { name: "获取验证码" }));
    await screen.findByText(/秒后重新获取/);
    first.unmount();

    // A reload: same tab, fresh page.
    render(form());
    await waitFor(() =>
      expect(screen.getByLabelText("手机号")).toHaveValue("13800138000"),
    );
    expect(screen.getByRole("button", { name: /秒后重新获取/ })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("验证码"), {
      target: { value: "123456" },
    });
    fireEvent.change(screen.getByLabelText("设置新密码"), {
      target: { value: "new-password1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "重置密码" }));
    await waitFor(() => expect(api.resetPassword).toHaveBeenCalledOnce());
    expect(navigate).toHaveBeenCalledWith(
      "/login?reset=done&returnTo=%2Faccount%2Fsecurity",
    );
    expect(sessionStorage.getItem("crm.auth.code.reset")).toBeNull();
    expect(sessionStorage.getItem("crm.auth.phone")).toBe("13800138000");
  });

  it("says how long to wait when sending is limited, without a request id", async () => {
    const api: AuthApi = {
      requestRegisterCode: vi.fn(),
      register: vi.fn(),
      login: vi.fn(),
      requestPasswordResetCode: vi.fn().mockRejectedValue({
        code: "RATE_LIMITED",
        message: "操作过于频繁，请稍后再试。",
        requestId: "req_limit",
        status: 429,
        retryAfterSeconds: 1200,
      }),
      resetPassword: vi.fn(),
      listWorkspaces: vi.fn(),
    };
    render(
      <QueryClientProvider client={new QueryClient()}>
        <PasswordResetForm
          api={api}
          device={{ key: "device-test", summary: "Vitest browser" }}
        />
      </QueryClientProvider>,
    );
    fireEvent.change(screen.getByLabelText("手机号"), {
      target: { value: "13800138001" },
    });
    fireEvent.click(screen.getByRole("button", { name: "获取验证码" }));
    expect(
      await screen.findByText("验证码请求太频繁了，约 20 分钟后再试。"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/req_limit/)).toBeNull();
    expect(
      screen.getByRole("button", { name: "约 20 分钟后重新获取" }),
    ).toBeDisabled();
  });
});
