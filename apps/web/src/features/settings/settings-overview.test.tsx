import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { workspaceSettingsNavigation } from "@/components/navigation/workspace-navigation";

import { SettingsOverview } from "./settings-overview";

const groups = workspaceSettingsNavigation("northwind").filter(
  (group) => !group.items.every((item) => item.icon === "overview"),
);

function rowFor(label: string) {
  const row = screen.getByText(label, { selector: "strong" }).closest("a");
  if (!row) throw new Error(`No settings row for ${label}`);
  return row;
}

describe("SettingsOverview", () => {
  it("says which settings apply at once and which wait for publishing", () => {
    render(
      <SettingsOverview
        groups={groups}
        objectsHref="/workspace/northwind/settings/objects"
        status={{ pendingTables: 0, values: {} }}
      />,
    );
    expect(within(rowFor("成员")).getByText("保存即生效")).toBeInTheDocument();
    for (const label of ["业务表", "关系与自动化", "工作台配置"]) {
      expect(within(rowFor(label)).getByText("发布后生效")).toBeInTheDocument();
    }
    expect(within(rowFor("公司审计")).queryByText(/生效/)).toBeNull();
    expect(screen.queryByText("待发布")).not.toBeInTheDocument();
  });

  it("calls out unpublished tables and links to them", () => {
    render(
      <SettingsOverview
        groups={groups}
        objectsHref="/workspace/northwind/settings/objects"
        status={{
          pendingTables: 2,
          values: { object: "10 张使用中 · 2 张待发布" },
        }}
      />,
    );
    const attention = screen.getByText(/2 张业务表有未发布的修改/).closest("a");
    expect(attention).toHaveAttribute(
      "href",
      "/workspace/northwind/settings/objects",
    );
    expect(rowFor("业务表")).toHaveTextContent("10 张使用中 · 2 张待发布");
  });

  it("shows a failed status instead of dropping it", () => {
    render(
      <SettingsOverview
        groups={groups}
        objectsHref="/workspace/northwind/settings/objects"
        status={{ pendingTables: 0, values: { members: null } }}
      />,
    );
    expect(rowFor("成员")).toHaveTextContent("状态读取失败");
  });
});
