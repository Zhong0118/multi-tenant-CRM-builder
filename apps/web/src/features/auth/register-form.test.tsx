import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import type { AuthApi } from "./auth-api";
import { RegisterForm } from "./register-form";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

function renderForm(ui: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  );
}

describe("RegisterForm", () => {
  it("requests a code, starts a 60-second lock, and enters the only workspace", async () => {
    const api: AuthApi = {
      requestRegisterCode: vi.fn().mockResolvedValue({ accepted: true }),
      register: vi.fn().mockResolvedValue({
        accepted: true,
        user: {
          id: "user-1",
          displayName: "张三",
          phone: "+8613800138000",
          isPlatformAdmin: false,
        },
      }),
      login: vi.fn(),
      requestPasswordResetCode: vi.fn(),
      resetPassword: vi.fn(),
      listWorkspaces: vi.fn().mockResolvedValue([
        {
          memberId: "member-1",
          memberStatus: "ACTIVE",
          role: "EMPLOYEE",
          tenantCode: "acme",
          tenantId: "tenant-1",
          tenantName: "示例公司",
          tenantStatus: "ACTIVE",
        },
      ]),
    };
    const navigate = vi.fn();
    renderForm(
      <RegisterForm
        api={api}
        navigate={navigate}
        device={{ key: "device-test", summary: "Vitest browser" }}
      />,
    );

    fireEvent.change(screen.getByLabelText("手机号"), {
      target: { value: "13800138000" },
    });
    fireEvent.click(screen.getByRole("button", { name: "获取验证码" }));

    await waitFor(() =>
      expect(api.requestRegisterCode).toHaveBeenCalledWith({
        phone: "13800138000",
        deviceKey: "device-test",
      }),
    );
    expect(
      screen.getByRole("button", { name: /60 秒后重新获取/ }),
    ).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "验证码已发送至 13800138000",
    );

    fireEvent.change(screen.getByLabelText("姓名"), {
      target: { value: "张三" },
    });
    fireEvent.change(screen.getByLabelText("验证码"), {
      target: { value: "123456" },
    });
    fireEvent.change(screen.getByLabelText("设置密码"), {
      target: { value: "account-password1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "创建账号" }));

    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith("/workspace/acme"),
    );
    expect(api.register).toHaveBeenCalledWith({
      phone: "13800138000",
      code: "123456",
      displayName: "张三",
      password: "account-password1",
      deviceSummary: "Vitest browser",
    });
  });

  it("shows the missing-code instruction prominently before registration", async () => {
    const api: AuthApi = {
      requestRegisterCode: vi.fn(),
      register: vi.fn(),
      login: vi.fn(),
      requestPasswordResetCode: vi.fn(),
      resetPassword: vi.fn(),
      listWorkspaces: vi.fn(),
    };
    renderForm(
      <RegisterForm
        api={api}
        device={{ key: "device-test", summary: "Vitest browser" }}
      />,
    );

    fireEvent.change(screen.getByLabelText("手机号"), {
      target: { value: "13800138000" },
    });
    fireEvent.click(screen.getByRole("button", { name: "创建账号" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "请先为当前手机号获取验证码",
    );
    expect(api.register).not.toHaveBeenCalled();
  });

  it("clears a stale phone validation error when the phone changes", async () => {
    const api: AuthApi = {
      requestRegisterCode: vi.fn(),
      register: vi.fn(),
      login: vi.fn(),
      requestPasswordResetCode: vi.fn(),
      resetPassword: vi.fn(),
      listWorkspaces: vi.fn(),
    };
    renderForm(
      <RegisterForm
        api={api}
        device={{ key: "device-test", summary: "Vitest browser" }}
      />,
    );

    fireEvent.change(screen.getByLabelText("手机号"), {
      target: { value: "12500000000" },
    });
    fireEvent.click(screen.getByRole("button", { name: "获取验证码" }));
    expect(
      await screen.findByText("请输入有效的中国大陆手机号。"),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("手机号"), {
      target: { value: "13800138000" },
    });
    await waitFor(() =>
      expect(
        screen.queryByText("请输入有效的中国大陆手机号。"),
      ).not.toBeInTheDocument(),
    );
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
    renderForm(
      <RegisterForm
        api={api}
        device={{ key: "device-test", summary: "Vitest browser" }}
      />,
    );

    const password = screen.getByLabelText("设置密码");
    expect(password).toHaveAttribute("type", "password");
    fireEvent.click(screen.getByRole("button", { name: "显示密码" }));
    expect(password).toHaveAttribute("type", "text");
    expect(screen.getByRole("button", { name: "隐藏密码" })).toBeVisible();
  });

  it("requires a new code after the phone number changes", async () => {
    const api: AuthApi = {
      requestRegisterCode: vi.fn().mockResolvedValue({ accepted: true }),
      register: vi.fn(),
      login: vi.fn(),
      requestPasswordResetCode: vi.fn(),
      resetPassword: vi.fn(),
      listWorkspaces: vi.fn(),
    };
    renderForm(
      <RegisterForm
        api={api}
        device={{ key: "device-test", summary: "Vitest browser" }}
      />,
    );

    fireEvent.change(screen.getByLabelText("手机号"), {
      target: { value: "13800138000" },
    });
    fireEvent.click(screen.getByRole("button", { name: "获取验证码" }));
    await waitFor(() => expect(api.requestRegisterCode).toHaveBeenCalledOnce());
    fireEvent.change(screen.getByLabelText("验证码"), {
      target: { value: "123456" },
    });
    fireEvent.change(screen.getByLabelText("姓名"), {
      target: { value: "张三" },
    });
    fireEvent.change(screen.getByLabelText("设置密码"), {
      target: { value: "account-password1" },
    });
    fireEvent.change(screen.getByLabelText("手机号"), {
      target: { value: "13900139000" },
    });

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "获取验证码" })).toBeEnabled(),
    );
    expect(screen.getByLabelText("验证码")).toHaveValue("");
    fireEvent.click(screen.getByRole("button", { name: "创建账号" }));

    expect(
      await screen.findByText("请为当前手机号重新获取验证码。"),
    ).toBeInTheDocument();
    expect(api.register).not.toHaveBeenCalled();
  });

  it("discards a code response for a phone changed while the request is pending", async () => {
    let finishRequest: ((value: { accepted: boolean }) => void) | undefined;
    const api: AuthApi = {
      requestRegisterCode: vi.fn(
        () =>
          new Promise<{ accepted: boolean }>((resolve) => {
            finishRequest = resolve;
          }),
      ),
      register: vi.fn(),
      login: vi.fn(),
      requestPasswordResetCode: vi.fn(),
      resetPassword: vi.fn(),
      listWorkspaces: vi.fn(),
    };
    renderForm(
      <RegisterForm
        api={api}
        device={{ key: "device-test", summary: "Vitest browser" }}
      />,
    );

    fireEvent.change(screen.getByLabelText("手机号"), {
      target: { value: "13800138000" },
    });
    fireEvent.click(screen.getByRole("button", { name: "获取验证码" }));
    await waitFor(() => expect(api.requestRegisterCode).toHaveBeenCalledOnce());
    fireEvent.change(screen.getByLabelText("手机号"), {
      target: { value: "13900139000" },
    });
    finishRequest?.({ accepted: true });

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "获取验证码" })).toBeEnabled(),
    );
    expect(screen.queryByText(/秒后重新获取/)).not.toBeInTheDocument();
  });

  it("does not retry a completed registration when workspace discovery fails", async () => {
    const api: AuthApi = {
      requestRegisterCode: vi.fn().mockResolvedValue({ accepted: true }),
      register: vi.fn().mockResolvedValue({
        accepted: true,
        user: {
          id: "user-1",
          displayName: "张三",
          phone: "+8613800138000",
          isPlatformAdmin: false,
        },
      }),
      login: vi.fn(),
      requestPasswordResetCode: vi.fn(),
      resetPassword: vi.fn(),
      listWorkspaces: vi.fn().mockRejectedValue(new Error("network")),
    };
    const navigate = vi.fn();
    renderForm(
      <RegisterForm
        api={api}
        navigate={navigate}
        device={{ key: "device-test", summary: "Vitest browser" }}
      />,
    );

    fireEvent.change(screen.getByLabelText("手机号"), {
      target: { value: "13800138000" },
    });
    fireEvent.click(screen.getByRole("button", { name: "获取验证码" }));
    await waitFor(() => expect(api.requestRegisterCode).toHaveBeenCalledOnce());
    fireEvent.change(screen.getByLabelText("验证码"), {
      target: { value: "123456" },
    });
    fireEvent.change(screen.getByLabelText("姓名"), {
      target: { value: "张三" },
    });
    fireEvent.change(screen.getByLabelText("设置密码"), {
      target: { value: "account-password1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "创建账号" }));

    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/workspaces"));
    expect(api.register).toHaveBeenCalledOnce();
  });
});
