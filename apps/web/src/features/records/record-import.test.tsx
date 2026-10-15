import { webcrypto } from "node:crypto";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

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

beforeAll(() =>
  Object.defineProperty(globalThis.crypto, "subtle", {
    configurable: true,
    value: webcrypto.subtle,
  }),
);
function recordApi(): RecordApi {
  return {
    importRows: vi.fn<RecordApi["importRows"]>(
      async (_tenant, _object, input) => ({
        created: input.dryRun ? 0 : input.rows.length,
        failed: 0,
        skipped: 0,
        items: input.rows.map((row) => ({
          rowNumber: row.rowNumber,
          status: input.dryRun ? "READY" : "CREATED",
        })),
      }),
    ),
  } as unknown as RecordApi;
}
function setup(api = recordApi(), objectSchema = schema, admin = false) {
  const onCompleted = vi.fn();
  const onClose = vi.fn();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <RecordImportDrawer
        tenantCode="northwind"
        schema={objectSchema}
        canChooseOwner={admin}
        members={[
          { id: "m1", displayName: "员工甲" },
          { id: "m2", displayName: "员工乙" },
        ]}
        api={api}
        onCompleted={onCompleted}
        onClose={onClose}
      />
    </QueryClientProvider>,
  );
  return { api, onCompleted, onClose };
}
function chooseFile(content: BlobPart, name = "records.csv") {
  fireEvent.change(screen.getByLabelText("选择 Excel 或 CSV 文件"), {
    target: { files: [new File([content], name)] },
  });
}
async function checkAndImport() {
  fireEvent.click(screen.getByRole("button", { name: "检查数据" }));
  fireEvent.click(await screen.findByRole("button", { name: /确认导入/ }));
}
describe("RecordImportDrawer", () => {
  it("checks and imports with the selected owner, invalidates preview on change and locks ownership once started", async () => {
    const { api } = setup(recordApi(), schema, true);
    chooseFile("姓名\n新客户");
    await screen.findByText("1 行 · 1 列");
    fireEvent.mouseDown(screen.getByLabelText("导入负责人"));
    fireEvent.click(await screen.findByText("员工甲"));
    fireEvent.click(screen.getByRole("button", { name: "检查数据" }));
    await screen.findByRole("button", { name: /确认导入/ });
    fireEvent.mouseDown(screen.getByLabelText("导入负责人"));
    fireEvent.click(await screen.findByText("员工乙"));
    expect(
      screen.queryByRole("button", { name: /确认导入/ }),
    ).not.toBeInTheDocument();
    await checkAndImport();
    await screen.findByText(/成功 1 行/);
    expect(
      vi.mocked(api.importRows).mock.calls.map((call) => call[2].ownerMemberId),
    ).toEqual(["m1", "m2", "m2"]);
    expect(screen.getByLabelText("导入负责人")).toBeDisabled();
  });
  it("does not offer employees an owner override", () => {
    setup();
    expect(screen.queryByLabelText("导入负责人")).not.toBeInTheDocument();
  });
  it("checks without writing then imports coerced fields and retains the result", async () => {
    const { api, onCompleted } = setup();
    chooseFile("姓名,线索状态,备注\n张三,待联系,忽略");
    await screen.findByText("1 行 · 3 列");
    await checkAndImport();
    await screen.findByText(/成功 1 行，跳过 0 行，失败 0 行/);
    expect(api.importRows).toHaveBeenCalledTimes(2);
    const calls = vi.mocked(api.importRows).mock.calls;
    expect(calls[0][2]).toMatchObject({
      dryRun: true,
      rows: [{ rowNumber: 2, values: { name: "张三", lead_status: "new" } }],
    });
    expect(calls[1][2]).toMatchObject({
      dryRun: false,
      batchId: calls[0][2].batchId,
    });
    expect(screen.getByLabelText("映射 姓名")).toBeDisabled();
    expect(onCompleted).toHaveBeenCalled();
  });
  it("automatically reads GBK and blocks already damaged text", async () => {
    const { api } = setup();
    chooseFile(new Uint8Array([110, 97, 109, 101, 10, 0xd5, 0xc5, 0xc8, 0xfd]));
    await screen.findByText("张三");
    expect(screen.getByText(/当前按 GBK/)).toBeInTheDocument();
    chooseFile("姓名\n����");
    await screen.findByText(/乱码替代字符/);
    expect(screen.getByRole("button", { name: "检查数据" })).toBeDisabled();
    expect(api.importRows).not.toHaveBeenCalled();
  });
  it("blocks extra columns, duplicate mappings and missing required fields", async () => {
    setup();
    chooseFile("姓名\n张三,不能丢");
    await screen.findByText(/数据列数超过表头/);
    chooseFile("姓名,name\n张三,李四");
    await screen.findByText(/多个文件列映射到了同一字段/);
    expect(screen.getByRole("button", { name: "检查数据" })).toBeDisabled();
    chooseFile("名字,备注\n张三,未知");
    await screen.findByText(/尚未映射必填字段：姓名/);
    expect(screen.getByRole("button", { name: "检查数据" })).toBeDisabled();
  });
  it("rejects fake Excel and explains read failures", async () => {
    setup();
    chooseFile("not excel", "test.xlsx");
    await screen.findByText(/文件格式与后缀不符/);
    const file = new File([], "broken.csv");
    Object.defineProperty(file, "arrayBuffer", {
      value: () =>
        Promise.reject(new DOMException("unreadable", "NotReadableError")),
    });
    fireEvent.change(screen.getByLabelText("选择 Excel 或 CSV 文件"), {
      target: { files: [file] },
    });
    await screen.findByText("文件读取失败，请重新选择文件。");
  });
  it("ignores a late read from an old file", async () => {
    setup();
    let finish!: (b: ArrayBuffer) => void;
    const file = new File([], "old.csv");
    Object.defineProperty(file, "arrayBuffer", {
      value: () =>
        new Promise<ArrayBuffer>((resolve) => {
          finish = resolve;
        }),
    });
    fireEvent.change(screen.getByLabelText("选择 Excel 或 CSV 文件"), {
      target: { files: [file] },
    });
    chooseFile("姓名\n新文件");
    await screen.findByText("新文件");
    finish(new TextEncoder().encode("姓名\n旧文件").buffer);
    await waitFor(() =>
      expect(screen.queryByText("旧文件")).not.toBeInTheDocument(),
    );
  });
  it("retains successful batches after a network interruption and checks only remaining rows", async () => {
    const api = recordApi();
    const original = vi.mocked(api.importRows).getMockImplementation()!;
    let writes = 0;
    vi.mocked(api.importRows).mockImplementation(async (...args) => {
      if (!args[2].dryRun && ++writes === 2) throw new Error("network");
      return original(...args);
    });
    setup(api);
    chooseFile(
      "姓名\n" + Array.from({ length: 201 }, (_, i) => `员工${i}`).join("\n"),
    );
    await screen.findByText("201 行 · 1 列");
    await checkAndImport();
    await screen.findByText(/成功 100 行/);
    await screen.findByText(/请求中断/);
    fireEvent.click(await screen.findByRole("button", { name: "检查剩余行" }));
    await screen.findByRole("button", { name: /确认导入/ });
    const lastChecks = vi.mocked(api.importRows).mock.calls.slice(5);
    expect(
      lastChecks
        .flatMap(([, , input]) => input.rows)
        .map((row) => row.rowNumber),
    ).toEqual(Array.from({ length: 101 }, (_, i) => i + 102));
    fireEvent.click(screen.getByRole("button", { name: /确认导入/ }));
    await screen.findByText(/成功 201 行，跳过 0 行，失败 0 行/);
  });
  it("keeps server validation failures visible and offers a failure download", async () => {
    const api = recordApi();
    vi.mocked(api.importRows).mockResolvedValue({
      created: 0,
      failed: 1,
      skipped: 0,
      items: [
        {
          rowNumber: 2,
          status: "FAILED",
          error: {
            code: "FIELD_INVALID",
            message: "字段值无效。",
            fields: ["lead_status"],
          },
        },
      ],
    });
    setup(api);
    chooseFile("姓名,线索状态\n张三,错误");
    await screen.findByText("1 行 · 2 列");
    fireEvent.click(screen.getByRole("button", { name: "检查数据" }));
    await screen.findByText(/第 2 行：线索状态：字段值无效/);
    expect(screen.getByRole("button", { name: "下载失败明细" })).toBeEnabled();
    expect(
      screen.queryByRole("button", { name: /确认导入/ }),
    ).not.toBeInTheDocument();
    expect(api.importRows).toHaveBeenCalledTimes(1);
  });
});

it("requires manual mapping for same-name fields and displays their types", async () => {
  setup(recordApi(), {
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
  });
  chooseFile("姓名,线索状态\n张三,待联系");
  await screen.findByText(/将跳过 1 列：线索状态/);
  fireEvent.mouseDown(screen.getByLabelText("映射 线索状态"));
  expect(
    screen.getByText("线索状态 · 单选（lead_status）"),
  ).toBeInTheDocument();
  expect(
    screen.getByText("线索状态 · 文本（text_status）"),
  ).toBeInTheDocument();
});
