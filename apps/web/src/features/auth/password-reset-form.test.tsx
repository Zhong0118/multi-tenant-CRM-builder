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
    expect(navigate).toHaveBeenCalledWith("/login");
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
      await screen.findByText("请为当前手机号重新获取验证码。"),
    ).toBeInTheDocument();
    expect(api.resetPassword).not.toHaveBeenCalled();
  });
});
