import type { TablePlan } from "@crm/contracts";
import { fieldTypeLabel } from "@/features/objects/object-types";
import styles from "./table-builder.module.css";

// Compare the labels and attributes associated with stable IDs. An ordered ID
// list detects moves even when all field and option labels stay the same.
function attributes(table: TablePlan) {
  const values = new Map<string, { label: string; value: string }>();
  function put(id: string, label: string, value?: string) {
    if (value !== undefined) values.set(id, { label, value });
  }
  put("table.name", "表名称", table.name);
  put("table.code", "表编码", table.code);
  put("table.description", "表说明", table.description);
  put("table.icon", "表图标", table.icon);
  put("table.reason", "建表理由", table.reason);
  const fieldName = (id: string) =>
    table.fields.find((f) => f.id === id)?.label ?? id;
  put("title", "记录标题", fieldName(table.titleFieldId));
  put("view", "默认列", table.view.columnIds.map(fieldName).join("、"));
  put("view.reason", "选列理由", table.view.reason);
  put("order", "字段顺序", table.fields.map((f) => f.label).join("、"));
  put(
    "intent",
    "待配置的权限",
    table.employeeIntent.map((i) => i.request + " · " + i.reason).join("；"),
  );
  for (const field of table.fields) {
    const prefix = "field." + field.id + ".";
    put(prefix + "label", "字段名称", field.label);
    put(prefix + "key", field.label + " · 字段键", field.fieldKey);
    put(prefix + "type", field.label + " · 类型", fieldTypeLabel(field.type));
    put(
      prefix + "required",
      field.label + " · 必填",
      field.required ? "是" : "否",
    );
    put(prefix + "reason", field.label + " · 理由", field.reason);
    for (const [key, value] of Object.entries(field.validation ?? {})) {
      put(prefix + key, field.label + " · " + key, String(value));
    }
    put(
      prefix + "options",
      field.label + " · 选项顺序",
      field.options?.map((o) => o.label).join("、"),
    );
    for (const option of field.options ?? []) {
      put(prefix + option.id, field.label + " · 选项", option.label);
      put(
        prefix + option.id + ".reason",
        option.label + " · 理由",
        option.reason,
      );
      put(prefix + option.id + ".key", option.label + " · 选项键", option.key);
    }
  }
  return values;
}

export function TableDiff({
  before,
  after,
}: {
  before: TablePlan;
  after: TablePlan;
}) {
  const a = attributes(before),
    b = attributes(after);
  const rows = [...new Set([...a.keys(), ...b.keys()])].filter(
    (key) => a.get(key)?.value !== b.get(key)?.value,
  );
  return rows.length ? (
    <table className={styles.diff} aria-label="单表调整差异">
      <thead>
        <tr>
          <th>变更项</th>
          <th>当前值</th>
          <th>建议值</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((key) => (
          <tr key={key}>
            <th>{(b.get(key) ?? a.get(key))?.label}</th>
            <td>{a.get(key)?.value || "—"}</td>
            <td>{b.get(key)?.value || (b.has(key) ? "—" : "移除")}</td>
          </tr>
        ))}
      </tbody>
    </table>
  ) : (
    <p>未发现改动</p>
  );
}
