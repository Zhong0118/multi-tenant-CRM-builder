import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { templateApi } from "./template-api";
import { TemplateCapture } from "./template-capture";
import type { TemplateCapturePreview } from "./template-types";

function preview(blocked = false): TemplateCapturePreview {
  return {
    configuration: { schemaVersion: 1, objects: [] },
    sourceTenant: { id: "source", name: "示例公司", code: "demo" },
    excluded: {
      unpublishedObjects: 1,
      memberOverrides: 2,
      selectedGoalRules: 1,
    },
    summary: {
      objects: [
        {
          id: "customer",
          code: "customer",
          name: "客户",
          fieldCount: 4,
          stateCount: 2,
          automationCount: 1,
          poolEnabled: true,
        },
      ],
      goalRuleCount: 1,
    },
    blocking: blocked
      ? [
          {
            code: "MEMBER_BINDING",
            message: "负责人默认值绑定了具体成员",
            path: "customer.owner.defaultValue",
          },
        ]
      : [],
    warnings: [{ code: "EXCLUDED", message: "指定员工的目标不会复制" }],
  };
}

function setup(result = preview()) {
  const api = templateApi({
    listSourceTenants: vi
      .fn()
      .mockResolvedValue({
        items: [
          {
            id: "source",
            name: "示例公司",
            code: "demo",
            activeAdminCount: 1,
            status: "ACTIVE",
          },
        ],
        total: 1,
        page: 1,
        limit: 20,
      }),
    capturePreview: vi.fn().mockResolvedValue(result),
    saveDraft: vi.fn(),
  });
  const onApply = vi.fn();
  const onClose = vi.fn();
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <TemplateCapture
        templateId="template"
        expectedVersion={3}
        api={api}
        onApply={onApply}
        onClose={onClose}
      />
    </QueryClientProvider>,
  );
  return { api, onApply, onClose };
}

async function requestPreview() {
  fireEvent.click(await screen.findByRole("radio", { name: /示例公司/ }));
  fireEvent.click(screen.getByRole("button", { name: "读取流程预览" }));
  return await screen.findByLabelText("待复制流程摘要");
}

describe("template capture", () => {
  it("previews the source and only replaces the local draft after explicit confirmation", async () => {
    const { api, onApply } = setup();
    const summary = await requestPreview();
    expect(within(summary).getByText("客户")).toBeInTheDocument();
    expect(screen.getByText(/未发布业务表 1/)).toBeInTheDocument();
    expect(api.capturePreview).toHaveBeenCalledWith("template", {
      sourceTenantId: "source",
      expectedVersion: 3,
    });
    expect(onApply).not.toHaveBeenCalled();
    expect(api.saveDraft).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "替换本地模板草稿" }));
    expect(onApply).toHaveBeenCalledWith(preview().configuration);
    expect(api.saveDraft).not.toHaveBeenCalled();
  });

  it("explains nonportable bindings and prevents applying blocked previews", async () => {
    const { onApply } = setup(preview(true));
    await requestPreview();
    expect(screen.getByText("负责人默认值绑定了具体成员")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "替换本地模板草稿" }),
    ).toBeDisabled();
    expect(onApply).not.toHaveBeenCalled();
  });

  it("keeps the source selection and allows retry after a version conflict", async () => {
    const { api, onApply } = setup();
    vi.mocked(api.capturePreview).mockRejectedValueOnce({
      status: 409,
      code: "CONFLICT",
      message: "模板已被修改，请刷新后重试",
      fieldErrors: {},
      requestId: "req_capture",
    });
    fireEvent.click(await screen.findByRole("radio", { name: /示例公司/ }));
    fireEvent.click(screen.getByRole("button", { name: "读取流程预览" }));
    expect(await screen.findByText(/模板已被修改/)).toBeInTheDocument();
    expect(onApply).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "读取流程预览" }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "替换本地模板草稿" }),
      ).toBeEnabled(),
    );
  });
});
