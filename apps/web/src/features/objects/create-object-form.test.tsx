import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

    expect(
      screen.getByText(/稳定标识是 northwind \+ 业务表代码/),
    ).toBeInTheDocument();
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

function setupFileCreate() {
  const api = objectApi();
  vi.mocked(api.createDraft).mockResolvedValue({
    object: { id: "new-object" },
  } as Awaited<ReturnType<ObjectApi["createDraft"]>>);
  const navigate = vi.fn();
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { mutations: { retry: false } } })
      }
    >
      <CreateObjectForm tenantCode="northwind" api={api} navigate={navigate} />
    </QueryClientProvider>,
  );
  fireEvent.change(screen.getByLabelText("业务表名称"), {
    target: { value: "客户表" },
  });
  fireEvent.change(screen.getByLabelText("业务表代码"), {
    target: { value: "customers" },
  });
  return { api, navigate };
}

it("uploads a file, lets admins confirm select options and creates structure in one request", async () => {
  const { api, navigate } = setupFileCreate();
  fireEvent.change(screen.getByLabelText("上传 Excel / CSV 生成字段"), {
    target: {
      files: [
        new File(
          ["姓名,数量,状态\n张三,12,在用\n李四,3,闲置"],
          "customers.csv",
        ),
      ],
    },
  });
  await screen.findByText("已识别 3 列 · 2 行数据");
  expect(api.createDraft).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "将状态设为单选" }));
  expect(screen.getByLabelText("第 3 列选项")).toHaveValue("在用\n闲置");
  fireEvent.change(screen.getByLabelText("第 1 列字段名称"), {
    target: { value: "客户姓名" },
  });
  fireEvent.click(screen.getByRole("button", { name: "创建业务表草稿" }));
  await waitFor(() => expect(api.createDraft).toHaveBeenCalledTimes(1));
  expect(api.createDraft).toHaveBeenCalledWith(
    "northwind",
    expect.objectContaining({
      name: "客户表",
      code: "customers",
      titleFieldKey: "col_1",
      initialFields: [
        expect.objectContaining({
          label: "客户姓名",
          type: "TEXT",
          required: true,
        }),
        expect.objectContaining({ type: "NUMBER", required: false }),
        expect.objectContaining({
          type: "SINGLE_SELECT",
          config: {
            options: [
              { key: "option_1", label: "在用", status: "ACTIVE" },
              { key: "option_2", label: "闲置", status: "ACTIVE" },
            ],
          },
        }),
      ],
    }),
  );
  expect(api.createField).not.toHaveBeenCalled();
  expect(api.publish).not.toHaveBeenCalled();
  expect(navigate).toHaveBeenCalledWith(
    "/workspace/northwind/settings/objects/new-object",
  );
});

it("blocks creation while reading and after errors until file mode is explicitly removed", async () => {
  const { api } = setupFileCreate();
  let finish!: (buffer: ArrayBuffer) => void;
  const file = new File([], "pending.csv");
  Object.defineProperty(file, "arrayBuffer", {
    value: () =>
      new Promise<ArrayBuffer>((resolve) => {
        finish = resolve;
      }),
  });
  fireEvent.change(screen.getByLabelText("上传 Excel / CSV 生成字段"), {
    target: { files: [file] },
  });
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "创建业务表草稿" }),
    ).toBeDisabled(),
  );
  finish(new TextEncoder().encode("name\n�").buffer);
  await screen.findByText(/乱码替代字符/);
  expect(screen.getByRole("button", { name: "创建业务表草稿" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "移除文件，手工建表" }));
  fireEvent.click(screen.getByRole("button", { name: "创建业务表草稿" }));
  await waitFor(() =>
    expect(api.createDraft).toHaveBeenCalledWith("northwind", {
      name: "客户表",
      code: "customers",
    }),
  );
});

it("ignores an old file that finishes after a newer selection", async () => {
  setupFileCreate();
  let finish!: (buffer: ArrayBuffer) => void;
  const file = new File([], "old.csv");
  Object.defineProperty(file, "arrayBuffer", {
    value: () =>
      new Promise<ArrayBuffer>((resolve) => {
        finish = resolve;
      }),
  });
  fireEvent.change(screen.getByLabelText("上传 Excel / CSV 生成字段"), {
    target: { files: [file] },
  });
  fireEvent.change(screen.getByLabelText("上传 Excel / CSV 生成字段"), {
    target: { files: [new File(["新字段\n内容"], "new.csv")] },
  });
  await screen.findByLabelText("第 1 列字段名称");
  finish(new TextEncoder().encode("旧字段\n内容").buffer);
  await waitFor(() =>
    expect(screen.getByLabelText("第 1 列字段名称")).toHaveValue("新字段"),
  );
});
