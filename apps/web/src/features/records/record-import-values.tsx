import { Button, Collapse, Select, Table } from "antd";
import { useMemo, useState } from "react";
import type { ImportColumnAdvice } from "@crm/contracts";
import type { PublishedFieldView } from "@/features/objects/object-types";
import {
  activeOptions,
  remainingImportValues,
  setRemainingImportValues,
  type ImportPreview,
} from "./record-import-assist";

export function ImportValues({
  rows,
  index,
  field,
  choices,
  advice,
  preview,
  headerRow,
  disabled,
  onChange,
  onAdopt,
}: {
  rows: string[][];
  index: number;
  field: PublishedFieldView;
  choices?: ReadonlyMap<string, string | null>;
  advice?: ImportColumnAdvice;
  preview?: ImportPreview;
  headerRow: number;
  disabled: boolean;
  onChange: (choices: ReadonlyMap<string, string | null>) => void;
  onAdopt: (value: string) => void;
}) {
  const [batchValues, setBatchValues] = useState<string[]>([]);
  const remaining = useMemo(
    () => remainingImportValues(rows, index, field, choices),
    [rows, index, field, choices],
  );
  const canUndo = batchValues.some((raw) => choices?.get(raw) === null);
  const options = useMemo(() => activeOptions(field), [field]);
  const { entries } = remaining;
  if (!entries.length) return null;
  return (
    <Collapse
      size="small"
      items={[
        {
          key: "values",
          label: "取值对照 · " + entries.length + " 个不同值",
          children: (
            <>
              {remaining.values.length > 0 && (
                <>
                  <Button
                    size="small"
                    disabled={disabled}
                    onClick={() => {
                      setBatchValues(remaining.values);
                      onChange(
                        setRemainingImportValues(choices, remaining.values),
                      );
                    }}
                  >
                    其余 {remaining.values.length} 个值都不对应（这些格留空）
                  </Button>
                  <small>
                    涉及 {remaining.rowCount} 行
                    {field.required ? "，此字段必填，留空的行检查会失败" : ""}
                  </small>
                </>
              )}
              {canUndo && (
                <Button
                  size="small"
                  disabled={disabled}
                  onClick={() => {
                    onChange(
                      setRemainingImportValues(choices, batchValues, true),
                    );
                    setBatchValues([]);
                  }}
                >
                  撤销本次批量留空
                </Button>
              )}
              <Table
                size="small"
                rowKey={([raw]) => raw}
                dataSource={entries}
                pagination={{
                  pageSize: 8,
                  showSizeChanger: false,
                  hideOnSinglePage: true,
                }}
                columns={[
                  {
                    title: "文件值",
                    render: (_, [raw, count]) => (
                      <>
                        {raw} · {count} 行
                      </>
                    ),
                  },
                  {
                    title: "写入选项",
                    render: (_, [raw]) => {
                      const key = choices?.get(raw);
                      const v = advice?.values?.find(
                        (v) =>
                          preview?.bindings.get(
                            headerRow + ":" + advice.col + ":" + v.value,
                          ) === raw,
                      );
                      const label =
                        v?.option === null
                          ? "不对应"
                          : options.find((o) => o.key === v?.option)?.label;
                      return (
                        <>
                          <Select
                            aria-label={"取值对照 " + raw}
                            placeholder="请选择"
                            allowClear
                            disabled={disabled}
                            value={
                              key === null
                                ? 0
                                : key === undefined
                                  ? undefined
                                  : 1 + options.findIndex((o) => o.key === key)
                            }
                            options={[
                              { value: 0, label: "不对应" },
                              ...options.map((o, i) => ({
                                value: i + 1,
                                label: o.label,
                              })),
                            ]}
                            onChange={(n: number | undefined) => {
                              const next = new Map(choices);
                              if (n === undefined) next.delete(raw);
                              else
                                next.set(
                                  raw,
                                  n === 0 ? null : options[n - 1].key,
                                );
                              setBatchValues((values) =>
                                values.filter((value) => value !== raw),
                              );
                              onChange(next);
                            }}
                          />
                          {key === null && <small>这些行的整格留空</small>}
                          {key === undefined &&
                            v?.confidence === "review" &&
                            label && (
                              <small>
                                建议{label} · 把握不大{" "}
                                <Button
                                  size="small"
                                  disabled={disabled}
                                  onClick={() => onAdopt(v.value)}
                                >
                                  采用
                                </Button>
                              </small>
                            )}
                          {key !== undefined && v?.option === key && (
                            <small>AI 建议</small>
                          )}
                        </>
                      );
                    },
                  },
                ]}
              />
            </>
          ),
        },
      ]}
    />
  );
}
