import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ConfigProvider } from "antd";
import { TemplateInitialization } from "./template-initialization";
import type {
  TemplateInitializationApi,
  TemplateInitializationGroups,
} from "./template-initialization-api";

const group = {
  templateVersionId: "version",
  objects: [
    {
      id: "customers",
      name: "客户",
      code: "customers",
      version: 2,
      poolConfigVersion: 3,
    },
    {
      id: "orders",
      name: "开单",
      code: "orders",
      version: 1,
      poolConfigVersion: 1,
    },
  ],
};
const conflict = {
  status: 409,
  code: "CONFLICT",
  message: "配置已改变",
  fieldErrors: {},
  requestId: "req_conflict",
};
function setup(empty = false) {
  const api: TemplateInitializationApi = {
    list: vi.fn().mockResolvedValue({ groups: empty ? [] : [group] }),
    publish: vi
      .fn()
      .mockResolvedValue({
        published: group.objects.map(({ id, name, code }) => ({
          id,
          name,
          code,
        })),
      }),
  };
  const onPublished = vi.fn();
  render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: {
            queries: { retry: false },
            mutations: { retry: false },
          },
        })
      }
    >
      <ConfigProvider theme={{ token: { motion: false } }}>
        <TemplateInitialization
          tenantCode="demo"
          api={api}
          onPublished={onPublished}
        />
      </ConfigProvider>
    </QueryClientProvider>,
  );
  return { api, onPublished };
}

describe("template initialization publication", () => {
  it("confirms the complete group and sends both draft and pool versions", async () => {
    const { api, onPublished } = setup();
    fireEvent.click(
      await screen.findByRole("button", { name: "发布初始化流程" }),
    );
    const dialog = screen.getByRole("dialog", { name: "发布初始化流程" });
    expect(within(dialog).getByText("客户")).toBeInTheDocument();
    expect(within(dialog).getByText("开单")).toBeInTheDocument();
    expect(api.publish).not.toHaveBeenCalled();
    fireEvent.click(
      within(dialog).getByRole("button", { name: "确认发布 2 张表" }),
    );
    await waitFor(() =>
      expect(api.publish).toHaveBeenCalledWith("demo", {
        templateVersionId: "version",
        objects: [
          { id: "customers", expectedVersion: 2, expectedPoolConfigVersion: 3 },
          { id: "orders", expectedVersion: 1, expectedPoolConfigVersion: 1 },
        ],
      }),
    );
    expect(await screen.findByText(/已发布 2 张业务表/)).toBeInTheDocument();
    expect(onPublished).toHaveBeenCalledOnce();
  });

  it("keeps graph errors visible, does not report success and requires reloading changed configuration", async () => {
    const { api, onPublished } = setup();
    vi.mocked(api.publish).mockRejectedValue({
      status: 409,
      code: "CONFLICT",
      message: "公海配置已被修改",
      fieldErrors: { "customers.pool": ["请重新读取并确认"] },
      requestId: "req_init",
    });
    fireEvent.click(
      await screen.findByRole("button", { name: "发布初始化流程" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "确认发布 2 张表" }));
    expect(await screen.findByText(/公海配置已被修改/)).toBeInTheDocument();
    expect(screen.getByText(/请重新读取并确认/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "确认发布 2 张表" }),
    ).toBeDisabled();
    expect(onPublished).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "重新读取配置" }));
    await waitFor(() => expect(api.list).toHaveBeenCalledTimes(2));
  });

  it("has no activation entry for companies without an eligible template group", async () => {
    const { api } = setup(true);
    await waitFor(() => expect(api.list).toHaveBeenCalledOnce());
    expect(
      screen.queryByRole("button", { name: "发布初始化流程" }),
    ).not.toBeInTheDocument();
  });

  it("still requires refreshing after a rejected publication is cancelled and reopened", async () => {
    const { api } = setup();
    vi.mocked(api.publish).mockRejectedValue(conflict);
    fireEvent.click(
      await screen.findByRole("button", { name: "发布初始化流程" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "确认发布 2 张表" }));
    await screen.findByText(/配置已改变/);
    fireEvent.click(screen.getByRole("button", { name: /取\s*消/ }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "发布初始化流程" }));

    const confirm = screen.getByRole("button", { name: "确认发布 2 张表" });
    expect(confirm).toBeDisabled();
    expect(screen.getByText(/配置已改变/)).toBeInTheDocument();
    fireEvent.click(confirm);
    expect(api.publish).toHaveBeenCalledOnce();
    expect(api.list).toHaveBeenCalledOnce();
  });

  it.each(["pending", "failed"])(
    "blocks stale reconfirmation while a reload is %s, then requires confirming the new versions",
    async (reloadState) => {
      const { api, onPublished } = setup();
      vi.mocked(api.publish).mockRejectedValueOnce(conflict);
      fireEvent.click(
        await screen.findByRole("button", { name: "发布初始化流程" }),
      );
      fireEvent.click(screen.getByRole("button", { name: "确认发布 2 张表" }));
      await screen.findByText(/配置已改变/);

      let completeReload!: (value: TemplateInitializationGroups) => void;
      const reload = new Promise<TemplateInitializationGroups>((resolve) => {
        completeReload = resolve;
      });
      if (reloadState === "failed") {
        vi.mocked(api.list).mockRejectedValueOnce({
          ...conflict,
          message: "读取失败",
        });
      } else {
        vi.mocked(api.list).mockReturnValueOnce(reload);
      }
      fireEvent.click(screen.getByRole("button", { name: "重新读取配置" }));
      await waitFor(() =>
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
      );
      if (reloadState === "failed") await screen.findByText("读取失败");
      fireEvent.click(screen.getByRole("button", { name: "发布初始化流程" }));

      const confirm = screen.getByRole("button", { name: "确认发布 2 张表" });
      expect(confirm).toBeDisabled();
      expect(screen.getByText(/配置已改变/)).toBeInTheDocument();
      fireEvent.click(confirm);
      expect(api.publish).toHaveBeenCalledOnce();
      expect(onPublished).not.toHaveBeenCalled();

      if (reloadState === "failed") {
        vi.mocked(api.list).mockReturnValueOnce(reload);
        fireEvent.click(screen.getByRole("button", { name: "重新读取配置" }));
      }
      await act(async () => {
        completeReload({
          groups: [
            {
              templateVersionId: "version",
              objects: [
                {
                  id: "customers",
                  name: "新客户",
                  code: "customers",
                  version: 4,
                  poolConfigVersion: 5,
                },
              ],
            },
          ],
        });
      });
      await waitFor(() =>
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
      );
      expect(await screen.findByText("新客户")).toBeInTheDocument();
      expect(api.publish).toHaveBeenCalledOnce();
      fireEvent.click(screen.getByRole("button", { name: "发布初始化流程" }));
      const newConfirm = screen.getByRole("button", {
        name: "确认发布 1 张表",
      });
      expect(newConfirm).toBeEnabled();
      expect(screen.queryByText(/配置已改变/)).not.toBeInTheDocument();
      vi.mocked(api.publish).mockResolvedValueOnce({
        published: [{ id: "customers", name: "新客户", code: "customers" }],
      });
      fireEvent.click(newConfirm);
      await waitFor(() =>
        expect(api.publish).toHaveBeenLastCalledWith("demo", {
          templateVersionId: "version",
          objects: [
            {
              id: "customers",
              expectedVersion: 4,
              expectedPoolConfigVersion: 5,
            },
          ],
        }),
      );
      expect(await screen.findByText(/已发布 1 张业务表/)).toBeInTheDocument();
      expect(onPublished).toHaveBeenCalledOnce();
    },
  );
});
