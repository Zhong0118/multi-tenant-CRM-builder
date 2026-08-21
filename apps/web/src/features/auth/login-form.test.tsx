import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import type { AuthApi } from "./auth-api";
import { LoginForm } from "./login-form";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

function renderForm(ui: ReactNode) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: {
            mutations: { retry: false },
            queries: { retry: false },
          },
        })
      }
    >
      {ui}
    </QueryClientProvider>,
  );
}

function baseApi(): AuthApi {
  return {
    requestRegisterCode: vi.fn(),
    register: vi.fn(),
    login: vi.fn(),
    requestPasswordResetCode: vi.fn(),
    resetPassword: vi.fn(),
    listWorkspaces: vi.fn().mockResolvedValue([]),
  };
}

describe("LoginForm", () => {
  it("enters the platform after an administrator logs in", async () => {
    const api = baseApi();
    vi.mocked(api.login).mockResolvedValue({
      accepted: true,
      user: {
        id: "admin-1",
        displayName: "平台管理员",
        phone: "+8615562266465",
        isPlatformAdmin: true,
      },
    });
    const navigate = vi.fn();
    renderForm(
      <LoginForm
        api={api}
        navigate={navigate}
        device={{ key: "device-test", summary: "Vitest browser" }}
      />,
    );

    fireEvent.change(screen.getByLabelText("手机号"), {
      target: { value: "15562266465" },
    });
    fireEvent.change(screen.getByLabelText("密码"), {
      target: { value: "account-password1" },
    });
    fireEvent.click(screen.getByRole("button", { name: /登\s*录/ }));

    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/platform"));
  });

  it("shows a top-level instruction for invalid client input", async () => {
    const api = baseApi();
    renderForm(
      <LoginForm
        api={api}
        navigate={vi.fn()}
        device={{ key: "device-test", summary: "Vitest browser" }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /登\s*录/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "请检查手机号和密码",
    );
    expect(api.login).not.toHaveBeenCalled();
  });

  it("offers an explicit password visibility control", () => {
    const api = baseApi();
    renderForm(
      <LoginForm
        api={api}
        navigate={vi.fn()}
        device={{ key: "device-test", summary: "Vitest browser" }}
      />,
    );

    const password = screen.getByLabelText("密码");
    fireEvent.click(screen.getByRole("button", { name: "显示密码" }));
    expect(password).toHaveAttribute("type", "text");
  });

  it("shows field errors and the request id from a failed API response", async () => {
    const api = baseApi();
    vi.mocked(api.login).mockRejectedValue({
      code: "VALIDATION_FAILED",
      message: "提交内容有误，请检查后重试。",
      fieldErrors: { phone: ["手机号格式错误"] },
      requestId: "req_login_123",
      status: 400,
    });
    renderForm(
      <LoginForm
        api={api}
        navigate={vi.fn()}
        device={{ key: "device-test", summary: "Vitest browser" }}
      />,
    );

    fireEvent.change(screen.getByLabelText("手机号"), {
      target: { value: "13800138000" },
    });
    fireEvent.change(screen.getByLabelText("密码"), {
      target: { value: "account-password1" },
    });
    fireEvent.click(screen.getByRole("button", { name: /登\s*录/ }));

    expect(await screen.findByText("手机号格式错误")).toBeInTheDocument();
    expect(screen.getByText(/req_login_123/)).toBeInTheDocument();
  });

  it("prevents duplicate submit and preserves an authorized return path", async () => {
    const api = baseApi();
    let finishLogin:
      ((value: Awaited<ReturnType<AuthApi["login"]>>) => void) | undefined;
    vi.mocked(api.login).mockImplementation(
      () =>
        new Promise((resolve) => {
          finishLogin = resolve;
        }),
    );
    const navigate = vi.fn();
    renderForm(
      <LoginForm
        api={api}
        navigate={navigate}
        returnTo="/account/security"
        device={{ key: "device-test", summary: "Vitest browser" }}
      />,
    );

    fireEvent.change(screen.getByLabelText("手机号"), {
      target: { value: "13800138000" },
    });
    fireEvent.change(screen.getByLabelText("密码"), {
      target: { value: "account-password1" },
    });
    const submit = screen.getByRole("button", { name: /登\s*录/ });
    fireEvent.click(submit);
    fireEvent.click(submit);

    await waitFor(() => expect(api.login).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("button", { name: "正在登录…" })).toBeDisabled();

    finishLogin?.({
      accepted: true,
      user: {
        id: "user-1",
        displayName: "张三",
        phone: "+8613800138000",
        isPlatformAdmin: false,
      },
    });
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith("/account/security"),
    );
  });

  it("keeps an authenticated login committed when workspace discovery fails", async () => {
    const api = baseApi();
    vi.mocked(api.login).mockResolvedValue({
      accepted: true,
      user: {
        id: "user-1",
        displayName: "张三",
        phone: "+8613800138000",
        isPlatformAdmin: false,
      },
    });
    vi.mocked(api.listWorkspaces).mockRejectedValue(new Error("network"));
    const navigate = vi.fn();
    renderForm(
      <LoginForm
        api={api}
        navigate={navigate}
        device={{ key: "device-test", summary: "Vitest browser" }}
      />,
    );

    fireEvent.change(screen.getByLabelText("手机号"), {
      target: { value: "13800138000" },
    });
    fireEvent.change(screen.getByLabelText("密码"), {
      target: { value: "account-password1" },
    });
    fireEvent.click(screen.getByRole("button", { name: /登\s*录/ }));

    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/workspaces"));
    expect(api.login).toHaveBeenCalledOnce();
  });
});
