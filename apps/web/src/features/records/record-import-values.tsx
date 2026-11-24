import { Button, Collapse, Select, Table } from "antd";
import { useMemo } from "react";
import type { ImportColumnAdvice } from "@crm/contracts";
import type { PublishedFieldView } from "@/features/objects/object-types";
import { matchImportOption } from "./record-csv";
import {
  activeOptions,
  importValueCounts,
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
  onChange: (raw: string, key: string | null | undefined) => void;
  onAdopt: (value: string) => void;
}) {
  const options = useMemo(() => activeOptions(field), [field]);
  const entries = useMemo(
    () =>
      [...importValueCounts(rows, index, field)].filter(
        ([v]) => matchImportOption(v, options) === undefined,
      ),
    [rows, index, field, options],
  );
  if (!entries.length) return null;
  return (
    <Collapse
      size="small"
      items={[
        {
          key: "values",
          label: "取值对照 · " + entries.length + " 个不同值",
          children: (
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
                          onChange={(n: number | undefined) =>
                            onChange(
                              raw,
                              n === undefined
                                ? undefined
                                : n === 0
                                  ? null
                                  : options[n - 1].key,
                            )
                          }
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
          ),
        },
      ]}
    />
  );
}
