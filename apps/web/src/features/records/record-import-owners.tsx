import { Select, Table } from "antd";
import type { DynamicFieldMember } from "./dynamic-field";
import {
  type ImportDestination,
  type resolveImportOwners,
} from "./record-import-groups";
import { memberSelectOptions } from "@/components/identity/member-identity";

export function ImportOwners({
  owners,
  members,
  resolved,
  poolEnabled,
  disabled,
  onChange,
}: {
  owners: ReturnType<typeof resolveImportOwners>;
  members: DynamicFieldMember[];
  resolved: Map<string, ImportDestination>;
  poolEnabled: boolean;
  disabled: boolean;
  onChange: (name: string, dest: ImportDestination) => void;
}) {
  const options = [
    ...memberSelectOptions(members),
    {
      value: ":pool",
      searchText: "公共池",
      label: poolEnabled ? "放入初始公共池" : "初始公共池未启用",
      disabled: !poolEnabled,
    },
    { value: ":skip", searchText: "不导入", label: "这些行不导入" },
  ];
  return (
    <Table
      size="small"
      rowKey="name"
      dataSource={owners}
      pagination={
        owners.length > 10 ? { pageSize: 10, showSizeChanger: false } : false
      }
      columns={[
        {
          title: "文件中的姓名",
          dataIndex: "name",
          render: (name: string) => name || "（空白）",
        },
        { title: "行数", dataIndex: "count", width: 64 },
        {
          title: "导入归属",
          render: (_, item) => {
            const chosen = resolved.get(item.name);
            return (
              <Select
                aria-label={`归属 ${item.name || "（空白）"}`}
                style={{ width: "100%" }}
                showSearch
                optionFilterProp="searchText"
                disabled={disabled}
                value={
                  chosen?.kind === "member"
                    ? chosen.id
                    : chosen
                      ? `:${chosen.kind}`
                      : undefined
                }
                placeholder={
                  item.matches.length > 1 ? "重名，请选择" : "未匹配，请选择"
                }
                options={options}
                onChange={(val: string) =>
                  onChange(
                    item.name,
                    val === ":skip"
                      ? { kind: "skip" }
                      : val === ":pool"
                        ? { kind: "pool" }
                        : { kind: "member", id: val },
                  )
                }
              />
            );
          },
        },
      ]}
    />
  );
}
