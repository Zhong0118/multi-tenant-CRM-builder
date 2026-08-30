import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { PublishedFieldView } from "@/features/objects/object-types";

import { DynamicField } from "./dynamic-field";

function field(overrides: Partial<PublishedFieldView>): PublishedFieldView {
  return {
    id: "field-id",
    fieldKey: "field_key",
    label: "字段",
    type: "TEXT",
    required: false,
    defaultValue: null,
    validation: {},
    config: {},
    sortOrder: 1,
    isSystem: false,
    access: "EDIT",
    ...overrides,
  } as PublishedFieldView;
}

const members = [
  { id: "member-lin", displayName: "林员工" },
  { id: "member-chen", displayName: "陈管理员" },
];

function openSelect(combobox: HTMLElement) {
  fireEvent.mouseDown(combobox);
}

/**
 * Ant Design renders each select option twice: a virtualized accessibility
 * mirror carrying the value, and the visible item carrying the label in its
 * title. Only the visible list holds every offered option, so that is what a
 * member actually sees.
 */
function optionLabels(): string[] {
  return Array.from(document.querySelectorAll(".ant-select-item-option")).map(
    (option) => option.getAttribute("title") ?? "",
  );
}

describe("DynamicField text-like types", () => {
  it("labels a required text control and shows its help text", () => {
    render(
      <DynamicField
        field={field({
          fieldKey: "customer_name",
          label: "客户名称",
          required: true,
          config: { help: "填写工商登记全称。" },
        })}
        value="百杰"
        onChange={vi.fn()}
      />,
    );

    const input = screen.getByLabelText("客户名称");
    expect(input).toHaveValue("百杰");
    expect(input).toBeEnabled();
    expect(screen.getByText("填写工商登记全称。")).toBeInTheDocument();
    expect(input).toHaveAttribute("aria-required", "true");
  });

  it("renders a multi-line control for TEXTAREA", () => {
    render(
      <DynamicField
        field={field({ fieldKey: "remark", label: "备注", type: "TEXTAREA" })}
        value=""
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("备注").tagName).toBe("TEXTAREA");
  });

  it("uses telephone and email input modes for PHONE and EMAIL", () => {
    const { unmount } = render(
      <DynamicField
        field={field({ fieldKey: "phone", label: "电话", type: "PHONE" })}
        value=""
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("电话")).toHaveAttribute("inputmode", "tel");
    unmount();

    render(
      <DynamicField
        field={field({ fieldKey: "email", label: "邮箱", type: "EMAIL" })}
        value=""
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("邮箱")).toHaveAttribute("inputmode", "email");
  });
});

describe("DynamicField numeric types", () => {
  it("emits a JSON number for NUMBER", () => {
    const onChange = vi.fn();
    render(
      <DynamicField
        field={field({ fieldKey: "seats", label: "座位数", type: "NUMBER" })}
        value={null}
        onChange={onChange}
      />,
    );

    fireEvent.change(screen.getByLabelText("座位数"), {
      target: { value: "12" },
    });

    expect(onChange).toHaveBeenLastCalledWith(12);
  });

  it("emits a fixed-scale decimal string for MONEY", () => {
    const onChange = vi.fn();
    render(
      <DynamicField
        field={field({
          fieldKey: "amount",
          label: "合同金额",
          type: "MONEY",
          validation: { scale: 2 },
        })}
        value={null}
        onChange={onChange}
      />,
    );

    const input = screen.getByLabelText("合同金额");
    fireEvent.change(input, { target: { value: "1200.5" } });
    fireEvent.blur(input);

    expect(onChange).toHaveBeenLastCalledWith("1200.50");
    expect(onChange).not.toHaveBeenCalledWith(1200.5);
  });

  it("clears an emptied optional numeric field to null", () => {
    const onChange = vi.fn();
    render(
      <DynamicField
        field={field({ fieldKey: "seats", label: "座位数", type: "NUMBER" })}
        value={12}
        onChange={onChange}
      />,
    );

    fireEvent.change(screen.getByLabelText("座位数"), {
      target: { value: "" },
    });

    expect(onChange).toHaveBeenLastCalledWith(null);
  });
});

describe("DynamicField date types", () => {
  it("emits a timezone-free calendar day for DATE", () => {
    const onChange = vi.fn();
    render(
      <DynamicField
        field={field({ fieldKey: "signed_on", label: "签约日", type: "DATE" })}
        value={null}
        onChange={onChange}
      />,
    );

    const input = screen.getByLabelText("签约日");
    fireEvent.change(input, { target: { value: "2026-08-21" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onChange).toHaveBeenLastCalledWith("2026-08-21");
  });

  it("emits a UTC instant for DATETIME", () => {
    const onChange = vi.fn();
    render(
      <DynamicField
        field={field({
          fieldKey: "called_at",
          label: "通话时间",
          type: "DATETIME",
        })}
        value={null}
        onChange={onChange}
      />,
    );

    const input = screen.getByLabelText("通话时间");
    fireEvent.change(input, { target: { value: "2026-08-21 09:30:00" } });
    fireEvent.keyDown(input, { key: "Enter" });

    const emitted = onChange.mock.calls.at(-1)?.[0];
    expect(emitted).toBe(new Date("2026-08-21T09:30:00").toISOString());
  });
});

describe("DynamicField select types", () => {
  const rating = field({
    fieldKey: "rating",
    label: "客户评级",
    type: "SINGLE_SELECT",
    config: {
      options: [
        { key: "gold", label: "金牌" },
        { key: "silver", label: "银牌" },
        { key: "legacy", label: "旧分级", status: "INACTIVE" },
      ],
    },
  });

  it("offers only active options for a new value", () => {
    render(<DynamicField field={rating} value={null} onChange={vi.fn()} />);

    openSelect(screen.getByLabelText("客户评级"));

    expect(optionLabels()).toEqual(["金牌", "银牌"]);
  });

  it("keeps a stored inactive option visible and marks it as retired", () => {
    render(<DynamicField field={rating} value="legacy" onChange={vi.fn()} />);

    openSelect(screen.getByLabelText("客户评级"));

    expect(optionLabels()).toEqual(["金牌", "银牌", "旧分级（已停用）"]);
  });

  it("renders a configured color on a read-only select value", () => {
    render(
      <DynamicField
        field={field({
          ...rating,
          access: "READ_ONLY",
          config: {
            options: [{ key: "gold", label: "金牌", color: "ORANGE" }],
          },
        })}
        value="gold"
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByText("金牌")).toHaveAttribute(
      "data-option-color",
      "ORANGE",
    );
  });

  it("emits an option key array for MULTI_SELECT", () => {
    const onChange = vi.fn();
    render(
      <DynamicField
        field={field({
          fieldKey: "channels",
          label: "获客渠道",
          type: "MULTI_SELECT",
          config: {
            options: [
              { key: "call", label: "电话" },
              { key: "referral", label: "转介绍" },
            ],
          },
        })}
        value={["call"]}
        onChange={onChange}
      />,
    );

    openSelect(screen.getByLabelText("获客渠道"));
    fireEvent.click(screen.getByTitle("转介绍"));

    expect(onChange).toHaveBeenLastCalledWith(["call", "referral"]);
  });

  it("offers active tenant members for MEMBER", () => {
    const onChange = vi.fn();
    render(
      <DynamicField
        field={field({
          fieldKey: "assignee",
          label: "跟进人",
          type: "MEMBER",
        })}
        value={null}
        onChange={onChange}
        members={members}
      />,
    );

    openSelect(screen.getByLabelText("跟进人"));
    fireEvent.click(screen.getByTitle("林员工"));

    expect(onChange).toHaveBeenLastCalledWith("member-lin");
  });

  it("keeps the option list reachable by keyboard", () => {
    const onChange = vi.fn();
    render(<DynamicField field={rating} value={null} onChange={onChange} />);

    const combobox = screen.getByLabelText("客户评级");
    openSelect(combobox);

    expect(combobox).toHaveAttribute("role", "combobox");
    expect(combobox).toHaveAttribute("aria-expanded", "true");
    expect(combobox).toHaveAttribute("aria-haspopup", "listbox");
    expect(combobox.getAttribute("aria-activedescendant")).toBeTruthy();
  });
});

describe("DynamicField boolean type", () => {
  it("uses a labelled switch and emits booleans", () => {
    const onChange = vi.fn();
    render(
      <DynamicField
        field={field({
          fieldKey: "is_key_account",
          label: "重点客户",
          type: "BOOLEAN",
        })}
        value={false}
        onChange={onChange}
      />,
    );

    const control = screen.getByRole("switch", { name: "重点客户" });
    fireEvent.click(control);

    expect(onChange).toHaveBeenLastCalledWith(true);
  });
});

describe("DynamicField access levels", () => {
  it("renders a read-only value with an explanation and no editable control", () => {
    render(
      <DynamicField
        field={field({
          fieldKey: "rating",
          label: "客户评级",
          type: "SINGLE_SELECT",
          access: "READ_ONLY",
          config: { options: [{ key: "gold", label: "金牌" }] },
        })}
        value="gold"
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByText("客户评级")).toBeInTheDocument();
    expect(screen.getByText("金牌")).toBeInTheDocument();
    expect(screen.getByText("仅管理员可编辑")).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("renders nothing at all for a hidden field", () => {
    const { container } = render(
      <DynamicField
        field={field({
          fieldKey: "internal_score",
          label: "内部评分",
          access: "HIDDEN",
        })}
        value="9"
        onChange={vi.fn()}
      />,
    );

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText("内部评分")).not.toBeInTheDocument();
    expect(screen.queryByText("9")).not.toBeInTheDocument();
  });
});

describe("DynamicField validation feedback", () => {
  it("associates a server error with the control it belongs to", () => {
    render(
      <DynamicField
        field={field({ fieldKey: "customer_name", label: "客户名称" })}
        value=""
        onChange={vi.fn()}
        error="客户名称为必填项。"
      />,
    );

    const input = screen.getByLabelText("客户名称");
    const describedBy = input.getAttribute("aria-describedby");

    expect(describedBy).toBeTruthy();
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(document.getElementById(describedBy!)).toHaveTextContent(
      "客户名称为必填项。",
    );
  });
});
