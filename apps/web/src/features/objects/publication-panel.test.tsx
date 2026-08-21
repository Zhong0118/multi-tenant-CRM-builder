import { render, screen } from "@testing-library/react";
import { fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { PublicationAnalysis } from "./object-types";
import { PublicationPanel } from "./publication-panel";

const analysis = (
  overrides: Partial<PublicationAnalysis> = {},
): PublicationAnalysis => ({
  blocking: [],
  warnings: [],
  changes: [],
  ...overrides,
});

describe("PublicationPanel", () => {
  it("separates blockers that must be fixed from warnings to accept", () => {
    render(
      <PublicationPanel
        open
        analysis={analysis({
          blocking: [
            {
              code: "TITLE_FIELD_MISSING",
              message: "对象必须有一个必填标题字段。",
            },
          ],
          warnings: [
            {
              code: "FIELD_INACTIVATED",
              message: "停用字段后历史数据保留但不再显示。",
              fieldKey: "legacy_note",
            },
          ],
        })}
        onConfirm={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const blockers = screen.getByRole("group", { name: "必须先解决" });
    const warnings = screen.getByRole("group", { name: "发布后请注意" });

    expect(blockers).toHaveTextContent("对象必须有一个必填标题字段。");
    expect(warnings).toHaveTextContent("停用字段后历史数据保留但不再显示。");
    expect(blockers).not.toHaveTextContent("历史数据保留");
  });

  it("refuses to publish while a blocker remains", () => {
    const onConfirm = vi.fn();
    render(
      <PublicationPanel
        open
        analysis={analysis({
          blocking: [
            { code: "DEFAULT_VIEW_MISSING", message: "请先配置默认列表视图。" },
          ],
        })}
        onConfirm={onConfirm}
        onClose={vi.fn()}
      />,
    );

    const confirm = screen.getByRole("button", { name: "确认发布" });
    expect(confirm).toBeDisabled();

    fireEvent.click(confirm);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("publishes the reviewed changes once nothing blocks", () => {
    const onConfirm = vi.fn();
    render(
      <PublicationPanel
        open
        analysis={analysis({
          changes: [
            { kind: "ADDED", fieldKey: "rating" },
            { kind: "INACTIVATED", fieldKey: "legacy_note" },
          ],
          warnings: [
            { code: "RECORDS_EXIST", message: "该对象已有 12 条业务记录。" },
          ],
        })}
        onConfirm={onConfirm}
        onClose={vi.fn()}
      />,
    );

    const changes = screen.getByRole("group", { name: "本次变更" });
    expect(changes).toHaveTextContent("新增");
    expect(changes).toHaveTextContent("rating");
    expect(changes).toHaveTextContent("停用");
    expect(changes).toHaveTextContent("legacy_note");

    fireEvent.click(screen.getByRole("button", { name: "确认发布" }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("states plainly when a draft carries no configuration change", () => {
    render(
      <PublicationPanel
        open
        analysis={analysis()}
        onConfirm={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText("本次发布没有配置变更。")).toBeInTheDocument();
    expect(
      screen.queryByRole("group", { name: "必须先解决" }),
    ).not.toBeInTheDocument();
  });

  it("keeps the panel open and reports a version conflict instead of publishing blindly", () => {
    render(
      <PublicationPanel
        open
        analysis={analysis({
          changes: [{ kind: "ADDED", fieldKey: "rating" }],
        })}
        error="配置已被其他管理员修改，请重新载入后再发布。"
        onConfirm={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(
      screen.getByText("配置已被其他管理员修改，请重新载入后再发布。"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "确认发布" })).toBeDisabled();
  });
});
