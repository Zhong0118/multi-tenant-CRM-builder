import { InfoCircleOutlined } from "@ant-design/icons";
import { Button, Tooltip } from "antd";
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
  READ_ALL_UPDATE_OWN: "可新建、查看全部，只改自己负责的",
};

function describe(preset: TableEmployeePreset) {
  const access = tableEmployeePresetAccess(preset);
  const scope = { NONE: "无", OWN: "本人负责", ALL: "全部" };
  return [
    access.canCreate ? "可新建" : "不可新建",
    "查看范围 " + scope[access.readScope],
    "修改范围 " + scope[access.updateScope],
    access.fieldAccess === "EDIT" ? "全部字段可编辑" : "全部字段隐藏",
  ];
}

/** What employees get once applied; the parts that open up are tinted. */
function Effect({ preset }: { preset: TableEmployeePreset }) {
  const before = describe("CLOSED");
  return (
    <p className={styles.effect}>
      应用后 ·{" "}
      {describe(preset).map((part, i) => (
        <span key={i} data-changed={part !== before[i] || undefined}>
          {i > 0 ? " · " : ""}
          {part}
        </span>
      ))}
    </p>
  );
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
      <h2 className={styles.presetsTitle}>
        确认员工权限
        <Tooltip title="所选权限随草稿保存，发布后生效。所有预设均关闭删除、导入和导出。">
          <button
            type="button"
            className={styles.info}
            aria-label="所选权限随草稿保存，发布后生效。所有预设均关闭删除、导入和导出。"
          >
            <InfoCircleOutlined aria-hidden />
          </button>
        </Tooltip>
      </h2>
      {tables.map((table) => {
        const recommendations = [
          ...new Set(table.employeeIntent.map((i) => i.recommendation)),
        ];
        const recommendation =
          recommendations.length === 1 ? recommendations[0] : null;
        const preset = selections[table.id];
        return (
          <div key={table.id} className={styles.preset}>
            <span className={styles.presetLabel}>
              <label htmlFor={`preset-${table.id}`}>
                {table.name}的员工权限
              </label>
              {table.employeeIntent.length > 0 && (
                <Tooltip
                  title={table.employeeIntent
                    .map((intent) => `需求：${intent.request}`)
                    .join("\n")}
                >
                  <button
                    type="button"
                    className={styles.info}
                    aria-label={table.employeeIntent
                      .map((intent) => `需求：${intent.request}`)
                      .join("；")}
                  >
                    <InfoCircleOutlined aria-hidden />
                  </button>
                </Tooltip>
              )}
            </span>
            <select
              id={`preset-${table.id}`}
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
            {recommendation &&
              recommendation !== "CLOSED" &&
              recommendation !== preset && (
                <Button onClick={() => onSelect(table.id, recommendation)}>
                  采用推荐 · {names[recommendation]}
                </Button>
              )}
            <Effect preset={preset} />
          </div>
        );
      })}
    </section>
  );
}
