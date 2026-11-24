import { webcrypto } from "node:crypto";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import type { RuntimeObjectSchema } from "@/features/objects/object-types";

import type { RecordApi } from "./record-api";
import { importBatchId } from "./record-import-file";
import * as assistApi from "./record-import-assist-api";
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
function setup(
  api = recordApi(),
  objectSchema = schema,
  admin = false,
  poolConfig?: import("./record-pool-api").RecordPoolConfig,
  assistEnabled = false,
) {
  const onCompleted = vi.fn();
  const onClose = vi.fn();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const rendered = render(
    <QueryClientProvider client={client}>
      <RecordImportDrawer
        tenantCode="northwind"
        schema={objectSchema}
        canChooseOwner={admin}
        assistEnabled={assistEnabled}
        poolConfig={poolConfig}
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
  return { ...rendered, client, api, onCompleted, onClose };
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
  it("counts only typed cells treated as empty in the checked plan", async () => {
    const { api } = setup(recordApi(), schema);
    chooseFile("姓名,线索状态\nNaN,#N/A\n普通姓名,null");
    await screen.findByText("2 行 · 2 列");
    fireEvent.click(await screen.findByRole("button", { name: "检查数据" }));
    await screen.findByText("已把 2 格 NaN/#N/A 按空值处理");
    expect(api.importRows).toHaveBeenCalledWith(
      "northwind",
      "customers",
      expect.objectContaining({
        rows: [
          { rowNumber: 2, values: { name: "NaN", lead_status: null } },
          { rowNumber: 3, values: { name: "普通姓名", lead_status: null } },
        ],
      }),
    );
  });
  it("changes physical header only on confirmation, applies the returned plan and restores the original header", async () => {
    const call = vi
      .spyOn(assistApi, "requestImportAssist")
      .mockResolvedValueOnce({
        version: 1,
        headerRow: 3,
        generatedAt: "2026-11-24T00:00:00Z",
        matchFields: ["name"],
        columns: [
          {
            col: "C1",
            target: { mode: "field", field: "name" },
            confidence: "high",
            reason: "名称写法相近",
          },
          {
            col: "C2",
            target: { mode: "field", field: "lead_status" },
            confidence: "review",
            reason: "需要核对",
          },
        ],
      });
    const { api } = setup(recordApi(), schema, false, undefined, true);
    chooseFile("清单,原件\n\n单位名称,客户状态\n第三行测试客户,待联系");
    fireEvent.click(await screen.findByRole("button", { name: "AI 帮我对列" }));
    await screen.findByText("建议第 3 行为表头");
    expect(screen.getByRole("button", { name: "检查数据" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "预览并改用第 3 行" }));
    await screen.findByText("1 行 · 2 列");
    expect(screen.getByRole("button", { name: "检查数据" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: /采\s*用/ }));
    fireEvent.click(screen.getByRole("button", { name: "检查数据" }));
    await screen.findByRole("button", { name: "确认导入 1 行" });
    expect(api.importRows).toHaveBeenCalledWith(
      "northwind",
      "customers",
      expect.objectContaining({
        dryRun: true,
        matchFields: ["name"],
        rows: [
          {
            rowNumber: 4,
            values: { name: "第三行测试客户", lead_status: "new" },
          },
        ],
      }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "恢复到 AI 之前的对照" }),
    );
    await screen.findByText("2 行 · 2 列");
    expect(
      screen.queryByRole("button", { name: "确认导入 1 行" }),
    ).not.toBeInTheDocument();
    expect(call).toHaveBeenCalledTimes(1);
    call.mockRestore();
  });
  it.each([
    ["OBJECT_ACTION_FORBIDDEN", true],
    ["AI_FEATURE_NOT_ENTITLED", false],
  ] as const)(
    "handles 403 %s at the original import gate",
    async (code, revoked) => {
      const call = vi
        .spyOn(assistApi, "requestImportAssist")
        .mockRejectedValueOnce({
          status: 403,
          code,
          message: "权限已变更",
          requestId: "r",
        });
      setup(recordApi(), schema, false, undefined, true);
      chooseFile("姓名,客户等级\n" + code + ",B级");
      fireEvent.click(
        await screen.findByRole("button", { name: "AI 帮我对列" }),
      );
      await screen.findByText(
        revoked ? "当前已无导入权限，请关闭抽屉" : "权限已变更 手动对照已保留",
      );
      expect(screen.queryByLabelText("映射 姓名") === null).toBe(revoked);
      if (revoked)
        expect(
          screen.queryByRole("button", { name: "检查数据" }),
        ).not.toBeInTheDocument();
      else
        expect(screen.getByRole("button", { name: "检查数据" })).toBeEnabled();
      call.mockRestore();
    },
  );
  it("keeps a manual mapping made while a late response is in flight", async () => {
    let finish!: (
      p: Awaited<ReturnType<typeof assistApi.requestImportAssist>>,
    ) => void;
    const call = vi
      .spyOn(assistApi, "requestImportAssist")
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
    const { api } = setup(recordApi(), schema, false, undefined, true);
    chooseFile("姓名,客户状态\n本地客户,待联系");
    fireEvent.click(await screen.findByRole("button", { name: "AI 帮我对列" }));
    fireEvent.mouseDown(screen.getByLabelText("映射 客户状态"));
    fireEvent.click(await screen.findByText("线索状态 · 单选"));
    expect(call.mock.calls[0][3].aborted).toBe(true);
    finish({
      version: 1,
      headerRow: 1,
      generatedAt: "",
      matchFields: [],
      columns: [
        {
          col: "C2",
          target: { mode: "skip" },
          confidence: "high",
          reason: "跳过",
        },
      ],
    });
    fireEvent.click(screen.getByRole("button", { name: "检查数据" }));
    await screen.findByRole("button", { name: "确认导入 1 行" });
    expect(api.importRows).toHaveBeenCalledWith(
      "northwind",
      "customers",
      expect.objectContaining({
        rows: [
          { rowNumber: 2, values: { name: "本地客户", lead_status: "new" } },
        ],
      }),
    );
    call.mockRestore();
  });
  it("preserves a manual choice after a timeout and retries only on click", async () => {
    const call = vi
      .spyOn(assistApi, "requestImportAssist")
      .mockRejectedValueOnce({
        status: 504,
        code: "AI_PROVIDER_TIMEOUT",
        message: "超时",
        requestId: "test",
      })
      .mockResolvedValueOnce({
        version: 1,
        headerRow: 1,
        generatedAt: "",
        columns: [],
        matchFields: [],
      });
    setup(recordApi(), schema, false, undefined, true);
    chooseFile("姓名,客户状态,企业名称\n时限测试,待联系,一家企业");
    fireEvent.mouseDown(await screen.findByLabelText("映射 客户状态"));
    fireEvent.click(await screen.findByText("线索状态 · 单选"));
    fireEvent.click(await screen.findByRole("button", { name: "AI 帮我对列" }));
    await screen.findByText("AI 这次没来得及给出建议，可以手动对照或再试一次");
    expect(call).toHaveBeenCalledTimes(1);
    fireEvent.click(await screen.findByRole("button", { name: "AI 帮我对列" }));
    await waitFor(() => expect(call).toHaveBeenCalledTimes(2));
    expect(call.mock.calls[1][2]).toEqual(call.mock.calls[0][2]);
    call.mockRestore();
  });
  it("honors a file attempt from before this tab was reloaded", async () => {
    const csv = "姓名,客户状态\n回到导入页,待联系";
    const identity = await importBatchId(new TextEncoder().encode(csv), "");
    sessionStorage.setItem(
      "crm.importAssist." + JSON.stringify(["northwind", null, identity]),
      "1",
    );
    setup(recordApi(), schema, false, undefined, true);
    chooseFile(csv);
    await screen.findByText("1 行 · 2 列");
    expect(
      screen.queryByRole("button", { name: "AI 帮我对列" }),
    ).not.toBeInTheDocument();
  });
  it("calls once per file after cancellation and ignores the late plan", async () => {
    let finish!: (
      plan: Awaited<ReturnType<typeof assistApi.requestImportAssist>>,
    ) => void;
    const call = vi
      .spyOn(assistApi, "requestImportAssist")
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
    setup(recordApi(), schema, false, undefined, true);
    const csv = "姓名,客户等级\n客户甲,A类";
    chooseFile(csv);
    fireEvent.click(await screen.findByRole("button", { name: "AI 帮我对列" }));
    expect(call).toHaveBeenCalledTimes(1);
    fireEvent.click(await screen.findByRole("button", { name: "取消生成" }));
    expect(call.mock.calls[0][3].aborted).toBe(true);
    finish({
      version: 1,
      generatedAt: "",
      headerRow: 1,
      columns: [],
      matchFields: [],
    });
    chooseFile(csv, "renamed.csv");
    await screen.findByText("1 行 · 2 列");
    expect(
      screen.queryByRole("button", { name: "AI 帮我对列" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "检查数据" })).toBeEnabled();
    expect(call).toHaveBeenCalledTimes(1);
    call.mockRestore();
  });
  it("lists every conversion error on the physical source row", async () => {
    const { api } = setup(recordApi(), {
      ...schema,
      fields: [
        ...schema.fields,
        {
          ...schema.fields[0],
          label: "预计金额",
          fieldKey: "amount",
          type: "MONEY",
        },
        {
          ...schema.fields[0],
          label: "预计成交日",
          fieldKey: "close",
          type: "DATE",
        },
      ],
    });
    chooseFile(
      "名单\n\n姓名,预计金额,线索状态,预计成交日\n\n\n张三,十二万,未知阶段,2024-02-30",
    );
    await screen.findByText("1 行 · 4 列");
    fireEvent.click(screen.getByRole("button", { name: "检查数据" }));
    await screen.findByText(
      "第 6 行：预计金额：数值格式无效，请检查符号、千分位和单位；线索状态：取值未对应唯一选项；预计成交日：日期无效",
    );
    expect(api.importRows).not.toHaveBeenCalled();
  });

  it.each([
    ["PHONE", "联系电话"],
    ["TEXT", "客户编号"],
  ] as const)(
    "warns about whole-row duplicates and suggests the mapped %s without selecting it",
    async (type, label) => {
      const { api } = setup(recordApi(), {
        ...schema,
        fields: [
          ...schema.fields,
          { ...schema.fields[0], type, label, fieldKey: "identifier" },
        ],
      });
      chooseFile(`姓名,${label},来源\n甲,001,展会\n甲,001,展会\n甲,001,转介`);
      await screen.findByText(/文件中有 2 行与其他行完全相同/);
      expect(
        screen.getByText(new RegExp("建议使用「" + label + "」查重")),
      ).toBeVisible();
      fireEvent.click(screen.getByRole("button", { name: "检查数据" }));
      await waitFor(() => expect(api.importRows).toHaveBeenCalled());
      expect(
        vi.mocked(api.importRows).mock.calls[0][2].matchFields ?? [],
      ).toEqual([]);
      expect(vi.mocked(api.importRows).mock.calls[0][2].rows).toHaveLength(3);
      chooseFile("姓名\n甲\n乙");
      await screen.findByText("2 行 · 1 列");
      expect(screen.queryByText(/与其他行完全相同/)).toBeNull();
    },
  );

  it("shows the first three distinct nonempty samples even after repeated or blank cells", async () => {
    setup();
    chooseFile("姓名,等级\n一,\n二,A级\n三,B级\n四,A级\n五,C级\n六,D级");
    expect(await screen.findByText("A级 · B级 · C级")).toBeVisible();
  });

  it("keeps a visible filename on cancel and reads a reselected file with the same name", async () => {
    const { api } = setup();
    expect(
      screen.getByRole("button", { name: "选择或拖入 Excel / CSV 文件" }),
    ).toBeVisible();
    chooseFile("姓名\n张三", "客户.csv");
    await screen.findByText("1 行 · 1 列");
    const picker = screen.getByRole("button", { name: /重新选择/ });
    expect(picker).toHaveTextContent("客户.csv");
    fireEvent.change(screen.getByLabelText("选择 Excel 或 CSV 文件"), {
      target: { files: [] },
    });
    expect(picker).toHaveTextContent("客户.csv");
    chooseFile("姓名\n张三\n李四", "客户.csv");
    await screen.findByText("2 行 · 1 列");
    fireEvent.drop(picker, {
      dataTransfer: { files: [new File(["姓名\n王五"], "替换.csv")] },
    });
    await screen.findByText("1 行 · 1 列");
    expect(picker).toHaveTextContent("替换.csv");
    expect(api.importRows).not.toHaveBeenCalled();
  });

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
  it("explains owner permission rejection during checking without claiming an interrupted import", async () => {
    const api = recordApi();
    vi.mocked(api.importRows).mockRejectedValue({
      code: "OWNER_INVALID",
      status: 400,
      requestId: "owner-check",
      fieldErrors: {},
      message: "目标成员需具有该业务表的读取和处理权限。",
    });
    const { onCompleted } = setup(api, schema, true);
    chooseFile("姓名\n新客户");
    await screen.findByText("1 行 · 1 列");
    fireEvent.mouseDown(screen.getByLabelText("导入负责人"));
    fireEvent.click(await screen.findByText("员工甲"));
    fireEvent.click(screen.getByRole("button", { name: "检查数据" }));
    await screen.findByText(
      /检查未通过：目标成员需具有该业务表的读取和处理权限/,
    );
    expect(screen.getByText(/读取、修改权限已生效/)).toBeInTheDocument();
    expect(screen.queryByText(/请求中断/)).not.toBeInTheDocument();
    expect(screen.queryByText(/已成功的行会保留/)).not.toBeInTheDocument();
    expect(screen.getByLabelText("导入负责人")).toBeEnabled();
    expect(
      vi.mocked(api.importRows).mock.calls.every((call) => call[2].dryRun),
    ).toBe(true);
    expect(onCompleted).not.toHaveBeenCalled();
  });

  it("preserves confirmed batches and explains a later permission rejection as a business error", async () => {
    const api = recordApi();
    const original = vi.mocked(api.importRows).getMockImplementation()!;
    let writes = 0;
    vi.mocked(api.importRows).mockImplementation(async (...args) => {
      if (!args[2].dryRun && ++writes === 2)
        throw {
          code: "OBJECT_ACTION_FORBIDDEN",
          status: 403,
          requestId: "import-permission",
          fieldErrors: {},
          message: "你没有此业务表的新增权限。",
        };
      return original(...args);
    });
    setup(api);
    chooseFile(
      "姓名\n" + Array.from({ length: 101 }, (_, i) => `客户${i}`).join("\n"),
    );
    await screen.findByText("101 行 · 1 列");
    await checkAndImport();
    await screen.findByText(/导入未完成：你没有此业务表的新增权限/);
    expect(
      screen.getByText(/已成功导入 100 行，数据已保留/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/请求中断/)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "检查剩余行" }),
    ).not.toBeInTheDocument();
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
    chooseFile("姓名,线索状态\n张三,待联系");
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

it("imports into the initial pool only after explicit selection and excludes owner override", async () => {
  const { api } = setup(recordApi(), schema, true, {
    enabled: true,
    lifecycleEnabled: true,
    ownershipTtlHours: null,
    version: 1,
  });
  expect(
    screen.getByRole("checkbox", { name: "确认导入到初始公共池" }),
  ).toBeChecked();
  fireEvent.mouseDown(screen.getByLabelText("导入负责人"));
  fireEvent.click(await screen.findByText("员工甲"));
  expect(
    screen.getByRole("checkbox", { name: "确认导入到初始公共池" }),
  ).not.toBeChecked();
  fireEvent.click(
    screen.getByRole("checkbox", { name: "确认导入到初始公共池" }),
  );
  expect(screen.getByLabelText("导入负责人")).toBeEnabled();
  chooseFile("姓名\n新客户");
  await screen.findByText("1 行 · 1 列");
  await checkAndImport();
  await screen.findByText(/成功 1 行/);
  const input = vi.mocked(api.importRows).mock.calls.at(-1)![2];
  expect(input.importToPool).toBe(true);
  expect(input).not.toHaveProperty("ownerMemberId");
});

it.each([{ queryFieldKeys: undefined }, { queryFieldKeys: ["name"] }])(
  "limits duplicate matching to shared fields while retaining own import mapping ($queryFieldKeys)",
  async ({ queryFieldKeys }) => {
    const { api } = setup(recordApi(), { ...schema, queryFieldKeys });
    chooseFile("姓名,线索状态\n张三,待联系");
    await screen.findByText("1 行 · 2 列");
    expect(
      screen.getByLabelText("映射 线索状态").closest(".ant-select"),
    ).toHaveTextContent("线索状态 · 单选");
    fireEvent.mouseDown(screen.getByLabelText("查重字段"));
    expect(
      screen.getByText("姓名", { selector: ".ant-select-item-option-content" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("线索状态", {
        selector: ".ant-select-item-option-content",
      }) !== null,
    ).toBe(queryFieldKeys === undefined);
    fireEvent.click(
      screen.getByText("姓名", { selector: ".ant-select-item-option-content" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "检查数据" }));
    await waitFor(() =>
      expect(api.importRows).toHaveBeenCalledWith(
        "northwind",
        "customers",
        expect.objectContaining({
          matchFields: ["name"],
          rows: [
            { rowNumber: 2, values: { name: "张三", lead_status: "new" } },
          ],
        }),
      ),
    );
  },
);
it("drops retained duplicate fields when shared query permission is removed", async () => {
  const { api, client, rerender, onCompleted, onClose } = setup();
  chooseFile("姓名,线索状态\n张三,待联系");
  await screen.findByText("1 行 · 2 列");
  fireEvent.mouseDown(screen.getByLabelText("查重字段"));
  fireEvent.click(
    screen.getByText("线索状态", {
      selector: ".ant-select-item-option-content",
    }),
  );
  rerender(
    <QueryClientProvider client={client}>
      <RecordImportDrawer
        tenantCode="northwind"
        schema={{ ...schema, queryFieldKeys: ["name"] }}
        api={api}
        onClose={onClose}
        onCompleted={onCompleted}
      />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "检查数据" }));
  await waitFor(() =>
    expect(api.importRows).toHaveBeenCalledWith(
      "northwind",
      "customers",
      expect.objectContaining({
        matchFields: [],
        rows: [{ rowNumber: 2, values: { name: "张三", lead_status: "new" } }],
      }),
    ),
  );
});

it("uses physical row three, appends two columns after the original note and keeps employee assignment local", async () => {
  const { api } = setup(recordApi(), {
    ...schema,
    fields: [
      ...schema.fields,
      {
        ...schema.fields[0],
        id: "notes",
        fieldKey: "notes",
        label: "备注",
        type: "TEXTAREA",
        required: false,
      },
    ],
  });
  chooseFile(
    "业务底表\n\n姓名,备注,来源渠道,客户评价,销售员\n张三,待联系,展会,满意,员工乙",
  );
  await screen.findByText(/已识别第 3 行为表头/);
  expect(screen.getByText(/仅公司管理员可按行指定负责人/)).toBeInTheDocument();
  for (const header of ["来源渠道", "客户评价"]) {
    const control = screen.getByLabelText("映射 " + header);
    fireEvent.mouseDown(control);
    const list = document.getElementById(
      control.getAttribute("aria-controls")!,
    )!;
    fireEvent.click(
      within(list.closest(".ant-select-dropdown") as HTMLElement).getByText(
        "追加到「备注」",
        { selector: ".ant-select-item-option-content" },
      ),
    );
  }
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "检查数据" })).toBeEnabled(),
  );
  await checkAndImport();
  await waitFor(() => expect(api.importRows).toHaveBeenCalledTimes(2));
  const request = vi.mocked(api.importRows).mock.calls[1][2];
  expect(request.rows).toEqual([
    {
      rowNumber: 4,
      values: { name: "张三", notes: "待联系\n来源渠道：展会\n客户评价：满意" },
    },
  ]);
  expect(request).not.toHaveProperty("ownerMemberId");
  expect(request).not.toHaveProperty("importToPool");
});

it("requires admin resolution of unknown owners before checking and splits the confirmed rows", async () => {
  const { api } = setup(recordApi(), schema, true);
  chooseFile("姓名,业务员\n甲,员工乙\n乙,未匹配");
  await screen.findByText("2 行 · 2 列");
  expect(screen.getByRole("button", { name: "检查数据" })).toBeDisabled();
  fireEvent.click(screen.getByText(/查看负责人对照/));
  fireEvent.mouseDown(screen.getByLabelText("归属 未匹配"));
  const choices = document.querySelectorAll(".ant-select-item-option-content");
  expect(
    Array.from(choices)
      .slice(0, 2)
      .map((choice) => choice.textContent),
  ).toEqual(["初始公共池未启用", "这些行不导入"]);
  expect(choices[0].parentElement).toHaveClass(
    "ant-select-item-option-disabled",
  );
  fireEvent.click(
    await screen.findByText("这些行不导入", {
      selector: ".ant-select-item-option-content",
    }),
  );
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "检查数据" })).toBeEnabled(),
  );
  await checkAndImport();
  await waitFor(() => expect(api.importRows).toHaveBeenCalledTimes(2));
  for (const [, , input] of vi.mocked(api.importRows).mock.calls) {
    expect(input.ownerMemberId).toBe("m2");
    expect(input.rows).toEqual([{ rowNumber: 2, values: { name: "甲" } }]);
  }
});

it("invalidates a completed check when a mapped field becomes read-only", async () => {
  const { api, client, rerender, onClose, onCompleted } = setup();
  chooseFile("姓名,线索状态\n张三,待联系");
  await screen.findByText("1 行 · 2 列");
  fireEvent.click(screen.getByRole("button", { name: "检查数据" }));
  await screen.findByRole("button", { name: /确认导入/ });
  const restricted = {
    ...schema,
    fields: schema.fields.map((f) =>
      f.fieldKey === "lead_status" ? { ...f, access: "READ_ONLY" as const } : f,
    ),
  };
  rerender(
    <QueryClientProvider client={client}>
      <RecordImportDrawer
        schema={restricted}
        tenantCode="northwind"
        api={api}
        onClose={onClose}
        onCompleted={onCompleted}
      />
    </QueryClientProvider>,
  );
  expect(
    screen.queryByRole("button", { name: /确认导入/ }),
  ).not.toBeInTheDocument();
});

it("keeps a confirmed row locked to its original write when the remaining mapping is changed", async () => {
  const { api } = setup(recordApi(), schema, true);
  const mock = vi.mocked(api.importRows);
  const execute = mock.getMockImplementation()!;
  let interrupt = true;
  mock.mockImplementation(async (...args) => {
    if (!args[2].dryRun && args[2].ownerMemberId === "m2" && interrupt) {
      interrupt = false;
      throw new Error("network");
    }
    return execute(...args);
  });
  chooseFile("姓名,业务员,线索状态\n甲,员工甲,待联系\n乙,员工乙,待联系");
  await screen.findByText("2 行 · 3 列");
  await checkAndImport();
  await screen.findByText(/未收到结果的行待重查/);
  fireEvent.mouseDown(screen.getByLabelText("映射 线索状态"));
  fireEvent.click(
    await screen.findByText("跳过此列", {
      selector: ".ant-select-item-option-content",
    }),
  );
  expect(
    screen.queryByRole("button", { name: /确认导入/ }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "检查剩余行" }));
  fireEvent.click(await screen.findByRole("button", { name: /确认导入 1 行/ }));
  await screen.findByText(/成功 2 行/);
  const requests = mock.mock.calls.map(([, , input]) => input);
  expect(requests.slice(-2).map((req) => req.rows)).toEqual(
    Array.from({ length: 2 }, () => [{ rowNumber: 3, values: { name: "乙" } }]),
  );
  expect(new Set(requests.map((req) => req.batchId)).size).toBe(1);
});
