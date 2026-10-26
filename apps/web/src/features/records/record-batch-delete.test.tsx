import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { RecordSummary } from "@/features/objects/object-types";
import type { RecordApi } from "./record-api";
import { RecordBatchDeleteDrawer } from "./record-batch-delete";

const record: RecordSummary = {
  id: "r1",
  recordNo: "1",
  title: "客户甲",
  values: {},
  version: 3,
  ownerMemberId: null,
  inPublicPool: false,
  ownershipExpiresAt: null,
  createdAt: "2026-10-26",
  updatedAt: "2026-10-26",
};
const failure = (status: number) => ({
  status,
  code: "INTERNAL_ERROR",
  message: "暂时不可用",
  requestId: "test",
  fieldErrors: {},
});
function setup(
  records: RecordSummary[],
  remove: RecordApi["remove"],
  onChanged = vi.fn().mockResolvedValue(undefined),
) {
  const onClose = vi.fn();
  const view = render(
    <RecordBatchDeleteDrawer
      tenantCode="northwind"
      objectCode="customers"
      records={records}
      api={{ remove }}
      onClose={onClose}
      onChanged={onChanged}
    />,
  );
  return { ...view, onClose, onChanged };
}

describe("batch record deletion", () => {
  it("requires confirmation, preserves versions, and retries only failures", async () => {
    const remove = vi
      .fn<RecordApi["remove"]>()
      .mockResolvedValueOnce({ accepted: true })
      .mockRejectedValueOnce(failure(503))
      .mockResolvedValue({ accepted: true });
    setup(
      [record, { ...record, id: "r2", title: "客户乙", version: 8 }],
      remove,
    );
    expect(remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "确认删除 2 条" }));
    await screen.findByText("成功删除 1 条，失败 1 条，未处理 0 条");
    expect(screen.getByText("客户乙：暂时不可用")).toBeInTheDocument();
    await waitFor(() => {
      const retry = screen.getByRole("button", { name: "重试失败项" });
      expect(retry).toBeEnabled();
      expect(retry).not.toHaveClass("ant-btn-loading");
    });
    fireEvent.click(screen.getByRole("button", { name: "重试失败项" }));
    await screen.findByText("成功删除 2 条，失败 0 条，未处理 0 条");
    expect(remove.mock.calls).toEqual([
      ["northwind", "customers", "r1", 3],
      ["northwind", "customers", "r2", 8],
      ["northwind", "customers", "r2", 8],
    ]);
  });

  it("supports 1000 records with bounded concurrency and no repeated successful deletion", async () => {
    let active = 0,
      peak = 0;
    const remove = vi.fn<RecordApi["remove"]>().mockImplementation(async () => {
      active++;
      peak = Math.max(peak, active);
      await Promise.resolve();
      active--;
      return { accepted: true };
    });
    setup(
      Array.from({ length: 1000 }, (_, i) => ({ ...record, id: `r${i}` })),
      remove,
    );
    fireEvent.click(screen.getByRole("button", { name: "确认删除 1000 条" }));
    await screen.findByText("成功删除 1000 条，失败 0 条，未处理 0 条");
    expect(remove).toHaveBeenCalledTimes(1000);
    expect(new Set(remove.mock.calls.map((call) => call[2])).size).toBe(1000);
    expect(peak).toBeLessThanOrEqual(4);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "重试失败项" })).toBeDisabled(),
    );
  });

  it.each([0, 1001])("refuses %i selected rows before any request", (count) => {
    const remove = vi.fn<RecordApi["remove"]>();
    setup(
      Array.from({ length: count }, (_, i) => ({ ...record, id: `r${i}` })),
      remove,
    );
    const confirm = screen.getByRole("button", {
      name: `确认删除 ${count} 条`,
    });
    expect(confirm).toBeDisabled();
    fireEvent.click(confirm);
    expect(remove).not.toHaveBeenCalled();
  });

  it("retries a failed refresh without repeating committed deletions", async () => {
    const remove = vi
      .fn<RecordApi["remove"]>()
      .mockResolvedValue({ accepted: true });
    const changed = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(undefined);
    setup([record], remove, changed);
    fireEvent.click(screen.getByRole("button", { name: "确认删除 1 条" }));
    const refresh = await screen.findByRole("button", { name: "重试刷新列表" });
    await waitFor(() => expect(refresh).toBeEnabled());
    fireEvent.click(refresh);
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "重试刷新列表" }),
      ).not.toBeInTheDocument(),
    );
    expect(remove).toHaveBeenCalledTimes(1);
    expect(changed).toHaveBeenCalledTimes(2);
  });

  it("does not report a missing or changed record as a successful deletion", async () => {
    const remove = vi
      .fn<RecordApi["remove"]>()
      .mockRejectedValueOnce(failure(404))
      .mockRejectedValueOnce(failure(409));
    setup([record, { ...record, id: "r2", title: "客户乙" }], remove);
    fireEvent.click(screen.getByRole("button", { name: "确认删除 2 条" }));
    await screen.findByText("成功删除 0 条，失败 2 条，未处理 0 条");
    expect(screen.getByText(/客户甲：.*刷新列表核对/)).toBeInTheDocument();
    expect(screen.getByText(/客户乙：.*重新选择/)).toBeInTheDocument();
  });

  it("blocks repeated confirmation and stops scheduling when leaving the page", async () => {
    let finish!: (value: { accepted: true }) => void;
    const request = new Promise<{ accepted: true }>((resolve) => {
      finish = resolve;
    });
    const remove = vi.fn<RecordApi["remove"]>().mockReturnValue(request);
    const { unmount, onChanged, onClose } = setup(
      Array.from({ length: 20 }, (_, i) => ({ ...record, id: `r${i}` })),
      remove,
    );
    fireEvent.click(screen.getByRole("button", { name: "确认删除 20 条" }));
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    expect(onClose).not.toHaveBeenCalled();
    expect(remove).toHaveBeenCalledTimes(4);
    unmount();
    await act(async () => {
      finish({ accepted: true });
      await request;
    });
    expect(remove).toHaveBeenCalledTimes(4);
    expect(onChanged).not.toHaveBeenCalled();
  });
});
