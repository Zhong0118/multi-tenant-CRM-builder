import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RelationshipMap } from "./relationship-map";

const nodes = [
  { code: "customer", name: "客户" },
  { code: "order", name: "开单" },
  { code: "supplier", name: "供应商" },
];
const edges = [
  {
    id: "customer:place-order",
    source: "customer",
    target: "order",
    label: "确认开单",
    trigger: "手动确认",
    enabled: true,
  },
  {
    id: "supplier:place-order",
    source: "supplier",
    target: "order",
    label: "供应商下单",
    trigger: "字段变化",
    enabled: false,
  },
];
describe("RelationshipMap", () => {
  it("opens the selected saved rule without mutating business data", () => {
    const select = vi.fn();
    render(<RelationshipMap nodes={nodes} edges={edges} onSelect={select} />);
    fireEvent.click(screen.getByLabelText("查看规则 确认开单"));
    expect(select).toHaveBeenCalledWith("customer:place-order");
    expect(screen.getByText("新建并关联")).toBeInTheDocument();
  });
  it("filters by table name and clearly distinguishes disabled rules", () => {
    render(<RelationshipMap nodes={nodes} edges={edges} onSelect={vi.fn()} />);
    expect(screen.getByText("已关闭")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("搜索业务表或规则"), {
      target: { value: "客户" },
    });
    expect(screen.getByLabelText("查看规则 确认开单")).toBeInTheDocument();
    expect(
      screen.queryByLabelText("查看规则 供应商下单"),
    ).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("搜索业务表或规则"), {
      target: { value: "不存在" },
    });
    expect(screen.getByText("没有匹配的关联规则")).toBeInTheDocument();
  });
});
