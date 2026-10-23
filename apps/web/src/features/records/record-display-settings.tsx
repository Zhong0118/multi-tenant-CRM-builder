"use client";

import { ArrowDownOutlined, ArrowUpOutlined } from "@ant-design/icons";
import { Button, Checkbox, Segmented, Select } from "antd";

import type { PublishedFieldView } from "@/features/objects/object-types";

import {
  READING_DENSITIES,
  type ReadingDensity,
  type RecordDisplayPrefs,
} from "./record-display-prefs";
import styles from "./record-list.module.css";

const DENSITY_TEXT_TYPES = new Set([
  "TEXT",
  "TEXTAREA",
  "EMAIL",
  "MULTI_SELECT",
]);

/**
 * One place for how a member reads the table: the reading density, which
 * columns and in what order, and per-column density where a column needs
 * more or less room. None of it changes the published table or permissions.
 */
export function RecordDisplaySettings({
  fields,
  columns,
  prefs,
  ownerChoice,
  onChange,
  onReset,
}: {
  /** Fields this member may see, in schema order. */
  fields: PublishedFieldView[];
  /** The visible field columns, in display order. */
  columns: string[];
  prefs: RecordDisplayPrefs;
  /** Whether the system owner column can be shown at all. */
  ownerChoice: boolean;
  onChange: (change: Partial<RecordDisplayPrefs>) => void;
  onReset: () => void;
}) {
  const hidden = fields.filter((field) => !columns.includes(field.fieldKey));
  const label = (key: string) =>
    fields.find((field) => field.fieldKey === key)?.label ?? key;
  const type = (key: string) =>
    fields.find((field) => field.fieldKey === key)?.type;
  const move = (index: number, delta: number) => {
    const next = [...columns];
    const [item] = next.splice(index, 1);
    next.splice(index + delta, 0, item);
    onChange({ columns: next });
  };

  return (
    <div className={styles.displayPanel} role="group" aria-label="显示设置">
      <section>
        <h3 className={styles.displayHeading} id="display-density">
          阅读密度
        </h3>
        <Segmented
          block
          aria-labelledby="display-density"
          value={prefs.density}
          onChange={(density) =>
            onChange({ density: density as ReadingDensity })
          }
          options={READING_DENSITIES.map((option) => ({
            value: option.value,
            label: option.label,
            title: option.hint,
          }))}
        />
        <p className={styles.displayHint}>
          {
            READING_DENSITIES.find((option) => option.value === prefs.density)
              ?.hint
          }
          。列宽可在表头拖动调整，双击恢复。
        </p>
      </section>

      <section>
        <h3 className={styles.displayHeading}>显示的列</h3>
        <ol className={styles.displayColumns}>
          {columns.map((key, index) => (
            <li key={key}>
              <Checkbox
                checked
                disabled={columns.length === 1}
                aria-label={`显示列 ${label(key)}`}
                onChange={() =>
                  onChange({
                    columns: columns.filter((column) => column !== key),
                  })
                }
              >
                {label(key)}
              </Checkbox>
              <span className={styles.displayColumnTools}>
                {DENSITY_TEXT_TYPES.has(type(key) ?? "") ? (
                  <Select
                    size="small"
                    variant="borderless"
                    aria-label={`${label(key)} 的阅读密度`}
                    popupMatchSelectWidth={false}
                    value={prefs.columnDensity[key] ?? "inherit"}
                    onChange={(value: string) => {
                      const next = { ...prefs.columnDensity };
                      if (value === "inherit") delete next[key];
                      else next[key] = value as ReadingDensity;
                      onChange({ columnDensity: next });
                    }}
                    options={[
                      { value: "inherit", label: "跟随" },
                      ...READING_DENSITIES.map((option) => ({
                        value: option.value,
                        label: option.label,
                      })),
                    ]}
                  />
                ) : null}
                <Button
                  type="text"
                  size="small"
                  aria-label={`上移 ${label(key)}`}
                  icon={<ArrowUpOutlined aria-hidden />}
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                />
                <Button
                  type="text"
                  size="small"
                  aria-label={`下移 ${label(key)}`}
                  icon={<ArrowDownOutlined aria-hidden />}
                  disabled={index === columns.length - 1}
                  onClick={() => move(index, 1)}
                />
              </span>
            </li>
          ))}
        </ol>
        {hidden.length ? (
          <>
            <h3 className={styles.displayHeading}>未显示</h3>
            <ul className={styles.displayColumns}>
              {hidden.map((field) => (
                <li key={field.fieldKey}>
                  <Checkbox
                    checked={false}
                    aria-label={`显示列 ${field.label}`}
                    onChange={() =>
                      onChange({ columns: [...columns, field.fieldKey] })
                    }
                  >
                    {field.label}
                  </Checkbox>
                </li>
              ))}
            </ul>
          </>
        ) : null}
        {ownerChoice ? (
          <Checkbox
            className={styles.displayOwner}
            checked={prefs.ownerVisible}
            aria-label="显示系统负责人"
            onChange={(event) =>
              onChange({ ownerVisible: event.target.checked })
            }
          >
            负责人
          </Checkbox>
        ) : null}
      </section>

      <footer className={styles.displayFooter}>
        <span>
          只影响你在这个浏览器里看到和导出的列，不改变业务表设置和权限。
        </span>
        <Button type="link" size="small" onClick={onReset}>
          恢复默认
        </Button>
      </footer>
    </div>
  );
}
