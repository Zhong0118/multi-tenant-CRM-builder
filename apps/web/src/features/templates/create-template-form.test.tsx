import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

import { CreateTemplateForm } from "./create-template-form";
import { templateApi } from "./template-api";

function renderWithQuery(ui: React.ReactNode) {
  return render(
    <QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>,
  );
}

function templateDetail() {
  return {
    id: "template-1",
    name: "销售模板",
    code: "sales",
    description: "标准销售对象",
    status: "DRAFT" as const,
    draftVersion: 1,
    hasUnpublishedChanges: false,
    objectCount: 0,
    fieldCount: 0,
    applicationCount: 0,
    activeVersion: null,
    publishedAt: null,
    createdAt: "2026-08-26T00:00:00.000Z",
    updatedAt: "2026-08-26T00:00:00.000Z",
    configuration: { schemaVersion: 1 as const, objects: [] },
  };
}

describe("CreateTemplateForm", () => {
  it("creates a template and navigates to its editor", async () => {
    const api = templateApi({
      create: vi.fn().mockResolvedValue(templateDetail()),
    });
    const navigate = vi.fn();
    renderWithQuery(<CreateTemplateForm api={api} navigate={navigate} />);

    fireEvent.change(screen.getByLabelText("模板名称"), {
      target: { value: "销售模板" },
    });
    fireEvent.change(screen.getByLabelText("模板代码"), {
      target: { value: "sales" },
    });
    fireEvent.change(screen.getByLabelText("模板说明"), {
      target: { value: "标准销售对象" },
    });
    fireEvent.click(screen.getByRole("button", { name: "创建模板" }));

    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith("/platform/templates/template-1"),
    );
  });

  it("rejects a template code longer than 64 characters before calling the API", async () => {
    const api = templateApi({
      create: vi.fn().mockResolvedValue(templateDetail()),
    });
    renderWithQuery(<CreateTemplateForm api={api} />);

    fireEvent.change(screen.getByLabelText("模板名称"), {
      target: { value: "销售模板" },
    });
    fireEvent.change(screen.getByLabelText("模板代码"), {
      target: { value: `a${"b".repeat(64)}` },
    });
    fireEvent.click(screen.getByRole("button", { name: "创建模板" }));

    expect(
      await screen.findByText("模板代码不能超过 64 个字符。"),
    ).toBeInTheDocument();
    expect(api.create).not.toHaveBeenCalled();
  });
});
