import { Button } from "antd";
import {
  TABLE_EMPLOYEE_PRESETS,
  tableEmployeePresetAccess,
  type TableEmployeePreset,
  type TablePlan,
} from "@crm/contracts";
import styles from "./table-builder.module.css";

const names: Record<TableEmployeePreset, string> = {
  CLOSED: "暂不开放",
  CREATE_OWN: "可新建，只看和改自己负责的",
  READ_ALL_UPDATE_OWN: "可查看全部，只改自己负责的",
};

function describe(preset: TableEmployeePreset) {
  const access = tableEmployeePresetAccess(preset);
  const scope = { NONE: "无", OWN: "本人负责", ALL: "全部" };
  return [
    access.canCreate ? "可新建" : "不可新建",
    "查看范围 " + scope[access.readScope],
    "修改范围 " + scope[access.updateScope],
    access.fieldAccess === "EDIT" ? "全部字段可编辑" : "全部字段隐藏",
  ].join(" · ");
}

export function EmployeePresets({
  tables,
  selections,
  onSelect,
}: {
  tables: TablePlan[];
  selections: Record<string, TableEmployeePreset>;
  onSelect: (id: string, preset: TableEmployeePreset) => void;
}) {
  return (
    <section className={styles.section} aria-label="确认员工权限">
      <h2>确认员工权限</h2>
      <p>所选权限随草稿保存，发布后生效。所有预设均关闭删除、导入和导出。</p>
      {tables.map((table) => {
        const recommendations = [
          ...new Set(table.employeeIntent.map((i) => i.recommendation)),
        ];
        const recommendation =
          recommendations.length === 1 ? recommendations[0] : null;
        const preset = selections[table.id];
        return (
          <div key={table.id}>
            <label>
              {table.name}的员工权限
              <select
                value={preset}
                onChange={(e) =>
                  onSelect(table.id, e.target.value as TableEmployeePreset)
                }
              >
                {TABLE_EMPLOYEE_PRESETS.map((key) => (
                  <option value={key} key={key}>
                    {names[key]}
                    {key === recommendation && key !== "CLOSED"
                      ? "（根据描述推荐）"
                      : ""}
                  </option>
                ))}
              </select>
            </label>
            {recommendation &&
              recommendation !== "CLOSED" &&
              recommendation !== preset && (
                <Button onClick={() => onSelect(table.id, recommendation)}>
                  采用推荐 · {names[recommendation]}
                </Button>
              )}
            {table.employeeIntent.map((intent, i) => (
              <p key={i}>权限需求 · {intent.request}</p>
            ))}
            <p>应用前 · {describe("CLOSED")}</p>
            <p>应用后 · {describe(preset)}</p>
          </div>
        );
      })}
    </section>
  );
}
