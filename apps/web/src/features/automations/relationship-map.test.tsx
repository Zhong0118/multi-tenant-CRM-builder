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

describe("RelationshipMap numbering", () => {
  it("numbers rules in list order and keeps the numbers when filtering", () => {
    render(<RelationshipMap nodes={nodes} edges={edges} onSelect={vi.fn()} />);
    expect(screen.getByLabelText("查看规则 确认开单")).toHaveTextContent("①");
    expect(screen.getByLabelText("查看规则 供应商下单")).toHaveTextContent("②");
    fireEvent.change(screen.getByLabelText("搜索业务表或规则"), {
      target: { value: "供应商" },
    });
    // The explanation beside the map still calls it ②.
    expect(screen.getByLabelText("查看规则 供应商下单")).toHaveTextContent("②");
  });

  it("groups each source table's rules under it and marks the selected one", () => {
    render(
      <RelationshipMap
        nodes={nodes}
        edges={edges}
        selectedId="supplier:place-order"
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByText("供应商").closest("li")).toHaveTextContent(
      "1 条规则",
    );
    expect(screen.getByLabelText("查看规则 供应商下单")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});

describe("ruleResult", () => {
  it("says what one execution leaves behind", async () => {
    const { ruleResult } = await import("./relationship-overview");
    const rule = {
      key: "won",
      label: "成交后生成合同",
      enabled: true,
      allowedRoles: ["EMPLOYEE" as const],
      trigger: {
        type: "FIELD_CHANGED" as const,
        fieldKey: "stage",
        equals: "won",
      },
      targetObjectCode: "contracts",
      owner: "SOURCE_OWNER" as const,
      mappings: {},
    };
    expect(ruleResult(rule, "合同")).toBe(
      "在「合同」新增 1 条记录，与来源记录互相关联；负责人沿用来源记录的负责人；每条来源记录只会自动创建一次",
    );
    expect(
      ruleResult(
        { ...rule, trigger: { type: "MANUAL" }, owner: "ACTOR" },
        "合同",
      ),
    ).toMatch(/负责人为执行的人；每次确认执行都会再新增一条$/);
  });
});
