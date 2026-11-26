import type { FieldPlan, TableBuilderIssue, TablePlan } from "@crm/contracts";
import {
  DeleteOutlined,
  PlusOutlined,
  ArrowUpOutlined,
  ArrowDownOutlined,
} from "@ant-design/icons";
import { Button } from "antd";
import {
  PUBLISHED_FIELD_TYPES,
  fieldTypeLabel,
  type ObjectDraft,
} from "@/features/objects/object-types";
import { AiBadge } from "@/components/ai/ai-badge";
import styles from "./table-builder.module.css";

const validationLabels: Record<string, string> = {
  minLength: "最少字符",
  maxLength: "最多字符",
  min: "最小值",
  max: "最大值",
  scale: "小数位",
  country: "国家或地区",
};

export function Issues({ items }: { items: TableBuilderIssue[] }) {
  return items.length ? (
    <ul className={styles.issues}>
      {items.map((i, n) => (
        <li key={i.path + n} data-blocking={i.blocking}>
          {i.blocking ? "需修正" : "提示"} · {i.message}
        </li>
      ))}
    </ul>
  ) : null;
}

export function TableEditor({
  table,
  target,
  issues,
  onChange,
}: {
  table: TablePlan;
  target?: ObjectDraft;
  issues: TableBuilderIssue[];
  onChange: (next: TablePlan) => void;
}) {
  const patch = (change: Partial<TablePlan>) =>
    onChange({ ...table, ...change });
  const fields = table.fields;
  const replaceField = (id: string, change: Partial<FieldPlan>) =>
    patch({
      fields: fields.map((f) => (f.id === id ? { ...f, ...change } : f)),
    });
  const setColumns = (ids: string[]) =>
    patch({ view: { ...table.view, columnIds: ids } });
  const names = new Map(fields.map((f) => [f.id, f.label]));
  // Table-level problems with the name or code sit under that input.
  const inputIssue = (path: "name" | "code") =>
    issues.find((i) => !i.fieldId && i.path === path);
  const nameIssue = inputIssue("name");
  const codeIssue = inputIssue("code");
  function moveColumn(from: number, to: number) {
    const ids = [...table.view.columnIds];
    ids.splice(to, 0, ids.splice(from, 1)[0]!);
    setColumns(ids);
  }
  return (
    <>
      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h2>{target ? "目标业务表" : "业务表设置"}</h2>
          {target && <code>{table.code}</code>}
        </div>
        {target ? (
          <>
            <strong>{target.object.name}</strong>
            <details>
              <summary>已有字段（{target.fields.length}）</summary>
              <ul>
                {target.fields.map((f) => (
                  <li key={f.id}>
                    {f.label} · {fieldTypeLabel(f.type)} ·{" "}
                    <code>{f.fieldKey}</code>
                  </li>
                ))}
              </ul>
            </details>
          </>
        ) : (
          <>
            <div className={styles.two}>
              <div className={styles.inputWithIssue}>
                <label>
                  表名称
                  <input
                    value={table.name}
                    aria-invalid={nameIssue?.blocking || undefined}
                    aria-describedby={
                      nameIssue ? "table-name-issue" : undefined
                    }
                    onChange={(e) => patch({ name: e.target.value })}
                  />
                </label>
                {nameIssue && (
                  <span
                    id="table-name-issue"
                    className={styles.inputIssue}
                    data-blocking={nameIssue.blocking}
                  >
                    {nameIssue.message}
                  </span>
                )}
              </div>
              <div className={styles.inputWithIssue}>
                <label>
                  表编码
                  <input
                    value={table.code}
                    maxLength={64}
                    spellCheck={false}
                    aria-invalid={codeIssue?.blocking || undefined}
                    aria-describedby={
                      codeIssue ? "table-code-issue" : undefined
                    }
                    onChange={(e) => patch({ code: e.target.value })}
                  />
                </label>
                {codeIssue && (
                  <span
                    id="table-code-issue"
                    className={styles.inputIssue}
                    data-blocking={codeIssue.blocking}
                  >
                    {codeIssue.message}
                  </span>
                )}
              </div>
            </div>
            <label>
              记录标题
              <select
                value={table.titleFieldId}
                onChange={(e) => patch({ titleFieldId: e.target.value })}
              >
                {!names.has(table.titleFieldId) && (
                  <option value={table.titleFieldId}>请选择标题字段</option>
                )}
                {fields.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              表说明
              <textarea
                rows={2}
                value={table.description ?? ""}
                onChange={(e) => patch({ description: e.target.value })}
              />
            </label>
            {/* Folded to one line; the full reason is a click away. */}
            {table.reason && (
              <details className={styles.reason}>
                <summary>
                  <AiBadge>AI 理由</AiBadge>
                </summary>
                <p>{table.reason}</p>
              </details>
            )}
          </>
        )}
        <Issues
          items={issues.filter(
            (i) =>
              (!i.fieldId || !names.has(i.fieldId)) &&
              i !== nameIssue &&
              i !== codeIssue,
          )}
        />
      </section>
      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h2>{target ? "建议新增字段" : "字段"}</h2>
          <span>{fields.length} 个</span>
        </div>
        {fields.length > 0 && (
          <div className={styles.fieldHead} aria-hidden>
            <span>字段名称</span>
            <span>字段键</span>
            <span>类型</span>
          </div>
        )}
        {fields.map((f, index) => (
          <div key={f.id} className={styles.field}>
            <div className={styles.fieldRow}>
              <label>
                <span className={styles.cellLabel}>字段名称</span>
                <input
                  aria-label={`字段名称 ${index + 1}`}
                  value={f.label}
                  onChange={(e) =>
                    replaceField(f.id, { label: e.target.value })
                  }
                />
              </label>
              <label>
                <span className={styles.cellLabel}>字段键</span>
                <input
                  aria-label={`字段键 ${index + 1}`}
                  value={f.fieldKey}
                  maxLength={64}
                  spellCheck={false}
                  onChange={(e) =>
                    replaceField(f.id, { fieldKey: e.target.value })
                  }
                />
              </label>
              <label>
                <span className={styles.cellLabel}>类型</span>
                <select
                  aria-label={`字段类型 ${index + 1}`}
                  value={f.type}
                  onChange={(e) =>
                    replaceField(f.id, {
                      type: e.target.value as FieldPlan["type"],
                    })
                  }
                >
                  {!PUBLISHED_FIELD_TYPES.some((t) => t === f.type) && (
                    <option value={f.type}>{f.type}</option>
                  )}
                  {PUBLISHED_FIELD_TYPES.map((type) => (
                    <option value={type} key={type}>
                      {fieldTypeLabel(type)}
                    </option>
                  ))}
                </select>
              </label>
              <label className={styles.check}>
                <input
                  type="checkbox"
                  checked={f.required}
                  onChange={(e) =>
                    replaceField(f.id, { required: e.target.checked })
                  }
                />
                必填
              </label>
              <Button
                type="text"
                icon={<DeleteOutlined />}
                aria-label={`移除字段 ${f.label}`}
                onClick={() =>
                  patch({ fields: fields.filter((x) => x.id !== f.id) })
                }
              />
            </div>
            {f.reason && (
              <small className={styles.fieldReason}>{f.reason}</small>
            )}
            {f.options?.length ||
            f.type === "SINGLE_SELECT" ||
            f.type === "MULTI_SELECT" ? (
              <div className={styles.options}>
                {f.options?.map((o, n) => (
                  <div key={o.id}>
                    <input
                      value={o.label}
                      aria-label={`${f.label}选项 ${n + 1}`}
                      onChange={(e) =>
                        replaceField(f.id, {
                          options: f.options?.map((x) =>
                            x.id === o.id ? { ...x, label: e.target.value } : x,
                          ),
                        })
                      }
                    />
                    <code>{o.key}</code>
                    <small>{o.reason}</small>
                    <Button
                      type="text"
                      aria-label={`移除选项 ${o.label}`}
                      icon={<DeleteOutlined />}
                      onClick={() =>
                        replaceField(f.id, {
                          options:
                            f.options?.length === 1
                              ? undefined
                              : f.options?.filter((x) => x.id !== o.id),
                        })
                      }
                    />
                  </div>
                ))}
                {(f.type === "SINGLE_SELECT" || f.type === "MULTI_SELECT") && (
                  <Button
                    size="small"
                    onClick={() =>
                      replaceField(f.id, {
                        options: [
                          ...(f.options ?? []),
                          {
                            id: crypto.randomUUID(),
                            label: "",
                            key: "",
                            reason: "管理员添加",
                          },
                        ],
                      })
                    }
                  >
                    添加选项
                  </Button>
                )}
              </div>
            ) : null}
            {Object.keys(f.validation ?? {}).length > 0 && (
              <div className={styles.options}>
                {Object.entries(f.validation ?? {}).map(([k, v]) => (
                  <label key={k}>
                    {validationLabels[k]}
                    <input
                      value={String(v)}
                      onChange={(e) => {
                        const value = e.target.value;
                        const validation = { ...f.validation };
                        if (!value)
                          delete validation[k as keyof typeof validation];
                        else
                          Object.assign(validation, {
                            [k]: typeof v === "number" ? Number(value) : value,
                          });
                        replaceField(f.id, { validation });
                      }}
                    />
                  </label>
                ))}
              </div>
            )}
            <Issues items={issues.filter((i) => i.fieldId === f.id)} />
          </div>
        ))}
        <Button
          icon={<PlusOutlined />}
          disabled={fields.length >= (target ? 10 : 40)}
          onClick={() =>
            patch({
              fields: [
                ...fields,
                {
                  id: crypto.randomUUID(),
                  label: "",
                  fieldKey: "",
                  type: "TEXT",
                  required: false,
                  reason: "管理员添加",
                },
              ],
            })
          }
        >
          添加字段
        </Button>
      </section>
      {!target && (
        <section className={styles.section}>
          <h2>默认列表</h2>
          <p>{table.view.reason}</p>
          <div className={styles.columns}>
            {table.view.columnIds.map((id, n) => (
              <div key={id}>
                <span>{names.get(id) || "已移除的字段"}</span>
                <Button
                  size="small"
                  type="text"
                  aria-label={`上移列 ${names.get(id)}`}
                  disabled={!n}
                  icon={<ArrowUpOutlined />}
                  onClick={() => moveColumn(n, n - 1)}
                />
                <Button
                  size="small"
                  type="text"
                  aria-label={`下移列 ${names.get(id)}`}
                  disabled={n === table.view.columnIds.length - 1}
                  icon={<ArrowDownOutlined />}
                  onClick={() => moveColumn(n, n + 1)}
                />
                <Button
                  size="small"
                  type="text"
                  aria-label={`移除列 ${names.get(id) ?? "已删除字段"}`}
                  icon={<DeleteOutlined />}
                  onClick={() =>
                    setColumns(table.view.columnIds.filter((cid) => cid !== id))
                  }
                />
              </div>
            ))}
          </div>
          {fields.some((f) => !table.view.columnIds.includes(f.id)) && (
            <select
              aria-label="添加默认列"
              value=""
              onChange={(e) =>
                setColumns([...table.view.columnIds, e.target.value])
              }
            >
              <option value="">添加默认列</option>
              {fields
                .filter((f) => !table.view.columnIds.includes(f.id))
                .map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label}
                  </option>
                ))}
            </select>
          )}
        </section>
      )}
      {target && (
        <section className={styles.section}>
          <h2>员工权限</h2>
          <p>新增字段对员工隐藏。已有字段与员工权限沿用当前配置。</p>
        </section>
      )}
    </>
  );
}
