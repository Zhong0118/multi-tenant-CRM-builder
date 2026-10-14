import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import type { RuntimeObjectSchema } from "@/features/objects/object-types";

import type { RecordApi } from "./record-api";
import { RecordImportDrawer } from "./record-import";

const schema = {
  publication: { number: 1, publishedAt: "2026-08-21T00:00:00.000Z" },
  object: {
    code: "customers",
    name: "客户",
    description: null,
    titleFieldKey: "name",
    icon: null,
    sortOrder: 1,
  },
  fields: [
    {
      id: "f-name",
      fieldKey: "name",
      label: "姓名",
      type: "TEXT",
      required: true,
      defaultValue: null,
      validation: {},
      config: {},
      sortOrder: 1,
      isSystem: false,
      access: "EDIT",
    },
    {
      id: "f-status",
      fieldKey: "lead_status",
      label: "线索状态",
      type: "SINGLE_SELECT",
      required: false,
      defaultValue: null,
      validation: {},
      config: {
        options: [{ key: "new", label: "待联系", status: "ACTIVE" }],
      },
      sortOrder: 2,
      isSystem: false,
      access: "EDIT",
    },
    {
      id: "f-owner",
      fieldKey: "owner",
      label: "跟进人",
      type: "MEMBER",
      required: false,
      defaultValue: null,
      validation: {},
      config: {},
      sortOrder: 3,
      isSystem: false,
      access: "EDIT",
    },
  ],
  defaultView: {
    code: "default",
    name: "默认",
    columnFieldKeys: ["name"],
    sort: { field: "updatedAt", direction: "desc" },
  },
  actions: {
    canCreate: true,
    canRead: true,
    canUpdate: true,
    canDelete: false,
  },
  scopes: { read: "ALL", update: "ALL" },
} as RuntimeObjectSchema;

function recordApi(overrides: Partial<RecordApi> = {}): RecordApi {
  return {
    list: vi.fn(),
    create: vi.fn(),
    detail: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    listActivities: vi.fn(),
    createActivity: vi.fn(),
    export: vi.fn(),
    batchUpdate: vi.fn(),
    importRows: vi.fn().mockResolvedValue({
      created: 1,
      failed: 1,
      items: [
        { rowNumber: 2, status: "CREATED" },
        {
          rowNumber: 3,
          status: "FAILED",
          error: {
            code: "FIELD_INVALID",
            message: "字段值无效。",
            fields: ["lead_status"],
          },
        },
      ],
    }),
    ...overrides,
  };
}

function renderDrawer(ui: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  );
}

describe("RecordImportDrawer", () => {
  it("maps CSV headers to writable fields and imports coerced values", async () => {
    const api = recordApi();
    const onCompleted = vi.fn();
    renderDrawer(
      <RecordImportDrawer
        tenantCode="northwind"
        schema={schema}
        api={api}
        onClose={vi.fn()}
        onCompleted={onCompleted}
      />,
    );

    const file = new File(
      ["姓名,线索状态,备注\n天际,待联系,忽略\n星云,坏状态,忽略\n"],
      "leads.csv",
      { type: "text/csv" },
    );
    fireEvent.change(screen.getByLabelText("选择 CSV 文件"), {
      target: { files: [file] },
    });

    expect(await screen.findByText("2 行 · 3 列")).toBeInTheDocument();
    expect(screen.queryByText("跟进人")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "导入映射后的行" }));

    await waitFor(() =>
      expect(api.importRows).toHaveBeenCalledWith("northwind", "customers", {
        batchId: expect.any(String),
        rows: [
          {
            rowNumber: 2,
            values: { name: "天际", lead_status: "new" },
          },
          {
            rowNumber: 3,
            values: { name: "星云", lead_status: "坏状态" },
          },
        ],
      }),
    );
    expect(screen.getByText(/成功 1 行，失败 1 行/)).toBeInTheDocument();
    expect(
      screen.getByText(/第 3 行：线索状态：字段值无效。/),
    ).toBeInTheDocument();
    expect(onCompleted).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /重试失败行/ }));
    await waitFor(() => expect(api.importRows).toHaveBeenCalledTimes(2));
    const calls = vi.mocked(api.importRows).mock.calls;
    expect(calls[1][2].batchId).toBe(calls[0][2].batchId);
    expect(calls[1][2].rows).toEqual([
      { rowNumber: 3, values: { name: "星云", lead_status: "坏状态" } },
    ]);
  });
});

function setupImport() {
  const api = recordApi();
  renderDrawer(
    <RecordImportDrawer
      tenantCode="northwind"
      schema={schema}
      api={api}
      onClose={vi.fn()}
      onCompleted={vi.fn()}
    />,
  );
  return api;
}

function chooseFile(content: BlobPart, name = "records.csv") {
  fireEvent.change(screen.getByLabelText("选择 CSV 文件"), {
    target: { files: [new File([content], name)] },
  });
}

it("blocks invalid UTF-8 instead of allowing replacement characters into records", async () => {
  const api = setupImport();
  chooseFile(new Uint8Array([110, 97, 109, 101, 10, 0xd5, 0xc5, 0xc8, 0xfd]));
  expect(await screen.findByText(/无法按 UTF-8 读取/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "导入映射后的行" })).toBeDisabled();
  expect(api.importRows).not.toHaveBeenCalled();
});

it("rejects rows wider than the header instead of silently truncating data", async () => {
  setupImport();
  chooseFile("姓名,线索状态\n张三,待联系,不能丢弃的内容\n");
  expect(await screen.findByText(/数据列数超过表头/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "导入映射后的行" })).toBeDisabled();
});

it("blocks duplicate mappings instead of silently overwriting the first column", async () => {
  setupImport();
  chooseFile("姓名,name\n张三,李四\n");
  expect(
    await screen.findByText(/多个文件列映射到了同一字段/),
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "导入映射后的行" })).toBeDisabled();
});

it("lets the user decode GBK bytes and locks encoding after the batch starts", async () => {
  const api = setupImport();
  chooseFile(new Uint8Array([110, 97, 109, 101, 10, 0xd5, 0xc5, 0xc8, 0xfd]));
  await screen.findByText(/无法按 UTF-8 读取/);
  fireEvent.mouseDown(screen.getByLabelText("文件编码"));
  fireEvent.click(screen.getByText("GBK / GB18030（中文 Windows）"));
  expect(await screen.findByText("张三")).toBeInTheDocument();
  expect(screen.queryByText(/无法按 UTF-8 读取/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "导入映射后的行" }));
  await waitFor(() =>
    expect(api.importRows).toHaveBeenCalledWith("northwind", "customers", {
      batchId: expect.any(String),
      rows: [{ rowNumber: 2, values: { name: "张三" } }],
    }),
  );
  expect(screen.getByLabelText("文件编码")).toBeDisabled();
});

it("explains missing required mappings and skipped columns before importing", async () => {
  setupImport();
  chooseFile("姓名拼写不同,额外备注\n张三,说明\n");
  expect(await screen.findByText(/尚未映射必填字段：姓名/)).toBeInTheDocument();
  expect(screen.getByText(/将跳过 2 列/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "导入映射后的行" })).toBeDisabled();
});

it("ignores a late read from a previously selected file", async () => {
  setupImport();
  let finish!: (buffer: ArrayBuffer) => void;
  const file = new File([], "old.csv");
  Object.defineProperty(file, "arrayBuffer", {
    value: () =>
      new Promise<ArrayBuffer>((resolve) => {
        finish = resolve;
      }),
  });
  fireEvent.change(screen.getByLabelText("选择 CSV 文件"), {
    target: { files: [file] },
  });
  chooseFile("姓名\n新文件\n", "new.csv");
  await screen.findByText("新文件");
  finish(new TextEncoder().encode("姓名\n旧文件\n").buffer);
  await waitFor(() => expect(screen.getByText("新文件")).toBeInTheDocument());
  expect(screen.queryByText("旧文件")).not.toBeInTheDocument();
});

it("reports file read failures and rejects native Excel files", async () => {
  setupImport();
  chooseFile("not csv", "table.xlsx");
  expect(
    await screen.findByText("只接受 CSV。Excel 请另存为 CSV UTF-8 后再导入。"),
  ).toBeInTheDocument();
  const file = new File([], "broken.csv");
  Object.defineProperty(file, "arrayBuffer", {
    value: () =>
      Promise.reject(new DOMException("unreadable", "NotReadableError")),
  });
  fireEvent.change(screen.getByLabelText("选择 CSV 文件"), {
    target: { files: [file] },
  });
  expect(
    await screen.findByText("文件读取失败，请重新选择文件。"),
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "导入映射后的行" })).toBeDisabled();
});

it("requires an explicit choice for same-name fields and shows their types", async () => {
  const sameNameSchema: RuntimeObjectSchema = {
    ...schema,
    fields: [
      ...schema.fields,
      {
        ...schema.fields[1],
        id: "f-text-status",
        fieldKey: "text_status",
        type: "TEXT",
      },
    ],
  };
  renderDrawer(
    <RecordImportDrawer
      tenantCode="northwind"
      schema={sameNameSchema}
      api={recordApi()}
      onClose={vi.fn()}
      onCompleted={vi.fn()}
    />,
  );
  chooseFile("姓名,线索状态\n张三,待联系\n");
  expect(await screen.findByText(/将跳过 1 列：线索状态/)).toBeInTheDocument();
  fireEvent.mouseDown(screen.getByLabelText("映射 线索状态"));
  expect(
    screen.getByText("线索状态 · 单选（lead_status）"),
  ).toBeInTheDocument();
  expect(
    screen.getByText("线索状态 · 文本（text_status）"),
  ).toBeInTheDocument();
});
