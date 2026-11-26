import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PlatformModelSettings } from "./model-settings";

vi.mock("../ai-governance/common", () => ({
  useSettings: () => ({
    data: {
      catalog: [{ label: "AI 建表", purpose: "text", outputLimit: 16000 }],
    },
  }),
}));

const model = (
  name: string,
  capabilities: string[],
  maxOutputTokens: number | null = 32768,
) => ({
  name,
  capabilities,
  contextTokens: 100000,
  maxOutputTokens,
  inputPrice: null,
  outputPrice: null,
  currency: null,
});
const test = {
  id: "check",
  sequence: 1,
  model: "vector",
  purpose: "embedding",
  status: "success",
  durationMs: 380,
  dimensions: 1024,
  steps: [{ name: "embedding", ok: true, durationMs: 350 }],
};
const provider = {
  id: "p",
  name: "百炼北京",
  preset: "bailian",
  version: 3,
  enabled: true,
  activeRevisionId: "r",
  draftRevisionId: null,
  revisions: [
    {
      id: "r",
      baseURL: "https://example.com/v1",
      protocol: "chat",
      embeddings: true,
      keyLast4: "••••",
      models: [
        model("vector", ["embedding"]),
        model("short", ["text"], 4096),
        model("writer", ["text"]),
        model("glm-4.6v", ["text", "vision"], null),
      ],
      tests: [test],
    },
  ],
};
const data = {
  providers: [provider],
  assignments: [
    {
      purpose: "embedding",
      providerId: "p",
      revisionId: "r",
      model: "vector",
      version: 2,
      dimensions: 1024,
    },
  ],
  environment: {
    configured: true,
    provider: "部署模型",
    model: "previous",
    missing: [],
  },
};
function show(
  respond?: (url: string, body: Record<string, unknown>) => unknown,
  state: () => unknown = () => data,
) {
  const send = vi.fn(async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    const result = url.endsWith("/ai-models")
      ? state()
      : await respond?.(url, body);
    return new Response(JSON.stringify(result ?? {}), { status: 200 });
  });
  vi.stubGlobal("fetch", send);
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <PlatformModelSettings />
    </QueryClientProvider>,
  );
  return send;
}
async function openChoices(label: string) {
  const control = screen.getByRole("combobox", { name: label });
  fireEvent.mouseDown(control);
  return waitFor(() => {
    expect(control).toHaveAttribute("aria-expanded", "true");
    const menu = document.getElementById(
      control.getAttribute("aria-controls")!,
    );
    expect(menu).toHaveAttribute("role", "listbox");
    return within(menu!);
  });
}
async function choose(label: string, name: string) {
  const menu = await openChoices(label);
  fireEvent.click(menu.getByRole("option", { name }));
}
afterEach(() => vi.unstubAllGlobals());
describe("平台模型设置", () => {
  it("测试失败的修改不影响正在使用的配置，并显示黄色状态", async () => {
    const pending = {
      ...provider.revisions[0],
      id: "draft",
      tests: [{ ...test, status: "failed" }],
    };
    show(undefined, () => ({
      ...data,
      providers: [
        {
          ...provider,
          draftRevisionId: pending.id,
          revisions: [pending, ...provider.revisions],
        },
      ],
    }));
    expect(
      await screen.findByText("修改未生效", { selector: "[data-tone]" }),
    ).toHaveAttribute("data-tone", "warning");
  });
  it("视觉分配和供应商编辑都说明最大输出未填写", async () => {
    const send = show();
    fireEvent.click(
      await screen.findByRole("button", { name: "更换视觉模型" }),
    );
    await choose("供应商", "百炼北京");
    const menu = await openChoices("模型");
    fireEvent.click(
      menu.getByRole("option", { name: /glm-4.6v.*请补齐最大输出/ }),
    );
    expect(send.mock.calls.some(([u]) => u.endsWith("/test"))).toBe(false);
    const dialog = within(screen.getByRole("dialog"));
    fireEvent.click(dialog.getByRole("button", { name: /取\s*消/ }));
    fireEvent.click(await screen.findByRole("button", { name: /编辑/ }));
    const editor = within(screen.getByRole("dialog"));
    fireEvent.click(editor.getByRole("button", { name: "下一步" }));
    await choose("编辑模型", "glm-4.6v");
    await choose("测试用途", "视觉模型");
    expect(editor.getByText("请补齐最大输出")).toBeInTheDocument();
    expect(editor.getByRole("button", { name: "测试连接" })).toBeDisabled();
  });
  it("连接的向量开关关闭时，模型清单与测试表单均禁止使用向量用途", async () => {
    const disabled = {
      ...provider,
      revisions: [{ ...provider.revisions[0], embeddings: false }],
    };
    const send = show(undefined, () => ({ ...data, providers: [disabled] }));
    fireEvent.click(
      await screen.findByRole("button", { name: "更换向量模型" }),
    );
    await choose("供应商", "百炼北京");
    const options = await openChoices("模型");
    fireEvent.click(
      options.getByRole("option", { name: "vector · 连接未开启向量接口" }),
    );
    expect(send.mock.calls.some(([url]) => url.endsWith("/test"))).toBe(false);
    const dialog = within(screen.getByRole("dialog"));
    fireEvent.click(dialog.getByRole("button", { name: /取\s*消/ }));
    fireEvent.click(await screen.findByRole("button", { name: /编辑/ }));
    const editor = within(screen.getByRole("dialog"));
    fireEvent.click(editor.getByRole("button", { name: "下一步" }));
    expect(editor.getByText("连接未开启向量接口")).toBeVisible();
    expect(editor.getByRole("button", { name: "测试连接" })).toBeDisabled();
  });
  it("文字沿用环境配置，向量分配展示实测维度、状态和延迟", async () => {
    show();
    expect(await screen.findByText("部署模型 / previous")).toBeInTheDocument();
    expect(screen.getByText("来自环境变量")).toBeInTheDocument();
    expect(screen.getByText("正常 · 1024 维 · 380 ms")).toBeInTheDocument();
  });
  it("选择后自动测，确认旧新模型和全公司影响后才分配", async () => {
    const send = show((url) =>
      url.endsWith("/test")
        ? {
            ...test,
            model: "writer",
            purpose: "text",
            steps: [{ name: "text", durationMs: 43, ok: true }],
          }
        : {},
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "更换文字模型" }),
    );
    const dialog = within(screen.getByRole("dialog"));
    await choose("供应商", "百炼北京");
    const options = await openChoices("模型");
    fireEvent.click(
      options.getByRole("option", { name: /short.*最大输出不足 16000/ }),
    );
    fireEvent.click(
      options.getByRole("option", { name: /vector.*不支持文字/ }),
    );
    expect(send.mock.calls.some(([url]) => url.endsWith("/test"))).toBe(false);
    fireEvent.click(options.getByRole("option", { name: "writer" }));
    expect(await dialog.findByText(/43 ms/)).toBeInTheDocument();
    expect(dialog.getByText(/所有公司立即生效/)).toBeInTheDocument();
    expect(dialog.getByText(/部署模型 \/ previous/)).toBeInTheDocument();
    expect(send.mock.calls.some(([url]) => url.includes("/assignments/"))).toBe(
      false,
    );
    fireEvent.click(dialog.getByRole("button", { name: "确认更换" }));
    await waitFor(() =>
      expect(
        send.mock.calls.some(
          ([url, init]) =>
            url.endsWith("/assignments/text") &&
            JSON.parse(String(init?.body)).testId === "check",
        ),
      ).toBe(true),
    );
  });
  it("Kimi 默认中国站，Key 单独提交，失败仅保存草稿", async () => {
    const requests: { path: string; body: Record<string, unknown> }[] = [];
    show((url, body) => {
      requests.push({ path: new URL(url).pathname, body });
      if (url.endsWith("/test"))
        return {
          ...test,
          status: "failed",
          errorCode: "CREDENTIAL_REJECTED",
          steps: [],
        };
      return {
        id: "kimi",
        version: url.endsWith("/key") ? 2 : 1,
        revisionId: "new",
      };
    });
    fireEvent.click(await screen.findByRole("button", { name: "添加供应商" }));
    const dialog = within(screen.getByRole("dialog"));
    fireEvent.click(dialog.getByRole("button", { name: "Kimi" }));
    fireEvent.click(dialog.getByRole("button", { name: "下一步" }));
    fireEvent.click(dialog.getByText("高级设置"));
    expect(dialog.getByLabelText("API 地址")).toHaveValue(
      "https://api.moonshot.cn/v1",
    );
    await choose("服务地域", "国际站");
    await choose("对话格式", "Responses");
    expect(dialog.getByLabelText("API 地址")).toHaveValue(
      "https://api.moonshot.ai/v1",
    );
    fireEvent.change(dialog.getByLabelText("API Key"), {
      target: { value: "test-only-input" },
    });
    fireEvent.click(dialog.getByRole("button", { name: "下一步" }));
    fireEvent.change(dialog.getByLabelText("最大输出 token"), {
      target: { value: "32768" },
    });
    fireEvent.click(dialog.getByRole("button", { name: "测试连接" }));
    expect(await dialog.findByText(/Key 无效/)).toBeInTheDocument();
    fireEvent.click(dialog.getByRole("button", { name: "保存草稿" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(
      requests
        .filter((req) => Object.values(req.body).includes("test-only-input"))
        .map((req) => req.path),
    ).toEqual(["/api/v1/platform/ai-models/providers/kimi/key"]);
    expect(
      requests.find((req) => req.path.endsWith("/providers"))?.body.protocol,
    ).toBe("responses");
    expect(requests.some((req) => req.path.endsWith("/activate"))).toBe(false);
  });
  it("向量维度有变化时，确认重建资料索引后才能应用", async () => {
    const send = show(() => ({ ...test, dimensions: 2048 }));
    fireEvent.click(
      await screen.findByRole("button", { name: "更换向量模型" }),
    );
    const modal = within(screen.getByRole("dialog"));
    await choose("供应商", "百炼北京");
    await choose("模型", "vector");
    const reindex = await modal.findByRole("checkbox", {
      name: /已有资料需要重新建立索引/,
    });
    const confirm = modal.getByRole("button", { name: "确认更换" });
    expect(confirm).toBeDisabled();
    fireEvent.click(reindex);
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(
        send.mock.calls.some(
          ([url, opts]) =>
            url.endsWith("/assignments/embedding") &&
            JSON.parse(String(opts?.body)).confirmReindex === true,
        ),
      ).toBe(true),
    );
  });
  it("转换只传命令，测试后明确确认文字用途才切换", async () => {
    const imported = {
      ...provider,
      id: "imported",
      name: "原环境连接",
      preset: "openai",
      revisions: [
        { ...provider.revisions[0], models: [model("previous", ["text"])] },
      ],
    };
    let importedOnServer = false;
    const send = show(
      (url) => {
        if (url.endsWith("/import-environment")) {
          importedOnServer = true;
          return { id: "imported", version: 3, revisionId: "r" };
        }
        if (url.endsWith("/test"))
          return {
            ...test,
            model: "previous",
            purpose: "text",
            dimensions: null,
          };
        return {};
      },
      () => ({
        ...data,
        providers: importedOnServer ? [provider, imported] : [provider],
      }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "转为平台配置" }),
    );
    const modal = within(await screen.findByRole("dialog"));
    fireEvent.click(modal.getByRole("button", { name: "测试连接" }));
    expect(await modal.findByText(/所有公司立即生效/)).toBeInTheDocument();
    expect(
      send.mock.calls
        .filter(([url]) => url.endsWith("/import-environment"))
        .map(([, opts]) => opts?.body),
    ).toEqual(["{}"]);
    expect(
      send.mock.calls.some(
        ([url]) => url.endsWith("/key") || url.includes("/assignments/"),
      ),
    ).toBe(false);
    fireEvent.click(modal.getByRole("button", { name: "确认转换" }));
    await waitFor(() =>
      expect(
        send.mock.calls.some(([url]) => url.endsWith("/assignments/text")),
      ).toBe(true),
    );
  });
  it("通过连接测试显示保存，并向服务器启用通过的连接", async () => {
    const send = show((url) => (url.endsWith("/test") ? test : { ok: true }));
    fireEvent.click(await screen.findByRole("button", { name: /编辑/ }));
    const modal = within(screen.getByRole("dialog"));
    expect(modal.getByLabelText("API Key")).toHaveValue("");
    fireEvent.click(modal.getByRole("button", { name: "下一步" }));
    fireEvent.click(modal.getByRole("button", { name: "测试连接" }));
    const save = await modal.findByRole("button", { name: /^保\s*存$/ });
    fireEvent.click(save);
    await waitFor(() =>
      expect(
        send.mock.calls.some(
          ([url, options]) =>
            url.endsWith("/activate") &&
            JSON.parse(String(options?.body)).revisionId === "r",
        ),
      ).toBe(true),
    );
  });
  it("在发现模型后修改连接地址需要再次输入目标地址的 Key", async () => {
    const send = show((url) =>
      url.endsWith("/discover")
        ? { models: ["discovered"] }
        : { id: "new-id", version: 2, revisionId: "r2" },
    );
    fireEvent.click(await screen.findByRole("button", { name: "添加供应商" }));
    const modal = within(screen.getByRole("dialog"));
    fireEvent.click(modal.getByRole("button", { name: "下一步" }));
    fireEvent.change(modal.getByLabelText("API Key"), {
      target: { value: "fixture-only" },
    });
    fireEvent.click(modal.getByRole("button", { name: "下一步" }));
    fireEvent.click(modal.getByRole("button", { name: /获取模型列表/ }));
    await modal.findByRole("combobox", { name: "发现的模型" });
    const created = send.mock.calls.find(([url]) => url.endsWith("/providers"));
    expect(JSON.parse(String(created?.[1]?.body))).toMatchObject({
      preset: "deepseek",
      protocol: "responses",
    });
    await choose("发现的模型", "discovered");
    expect(modal.getByLabelText("模型 ID")).toHaveValue("discovered");
    await choose("编辑模型", "deepseek-flash");
    await choose("测试用途", "视觉模型");
    expect(modal.getByLabelText("模型 ID")).toHaveValue("deepseek-flash");
    fireEvent.click(modal.getByRole("button", { name: "上一步" }));
    expect(modal.getByLabelText("API Key")).toHaveValue("");
    fireEvent.click(modal.getByText("高级设置"));
    fireEvent.change(modal.getByLabelText("API 地址"), {
      target: { value: "https://example.org/v1" },
    });
    expect(modal.getByRole("button", { name: "下一步" })).toBeDisabled();
  });
});
