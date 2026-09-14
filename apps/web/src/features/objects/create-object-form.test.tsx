import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CreateObjectForm } from "./create-object-form";
import type { ObjectApi } from "./object-api";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

describe("CreateObjectForm", () => {
  it("tells administrators the stable object identity is tenantCode plus objectCode", () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <CreateObjectForm tenantCode="northwind" api={objectApi()} />
      </QueryClientProvider>,
    );

    expect(screen.getByText(/稳定标识是 northwind \+ 业务表代码/)).toBeInTheDocument();
    expect(screen.getByText(/公司内唯一/)).toBeInTheDocument();
  });
});

function objectApi(): ObjectApi {
  return {
    listAccessible: vi.fn(),
    runtimeSchema: vi.fn(),
    listDrafts: vi.fn(),
    draft: vi.fn(),
    createDraft: vi.fn(),
    updateDraft: vi.fn(),
    reorderObjects: vi.fn(),
    createField: vi.fn(),
    updateField: vi.fn(),
    reorderFields: vi.fn(),
    updateDefaultView: vi.fn(),
    updatePermissions: vi.fn(),
    analyzePublication: vi.fn(),
    publish: vi.fn(),
    listPublications: vi.fn(),
    archive: vi.fn(),
    removeDraft: vi.fn().mockResolvedValue({ deleted: true }),
  };
}
