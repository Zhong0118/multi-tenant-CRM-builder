"use client";

import {
  Alert,
  Button,
  Checkbox,
  Input,
  Select,
  Space,
  Typography,
} from "antd";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  readImportFile,
  type ImportFile,
} from "@/features/records/record-import-file";
import type { CsvEncoding } from "@/features/records/record-csv";
import {
  FIELD_TYPE_LABELS,
  PUBLISHED_FIELD_TYPES,
  TITLE_FIELD_TYPES,
} from "./object-types";
import {
  buildFileObjectFields,
  changeFileFieldType,
  suggestObjectFields,
  type FileFieldType,
  type FileObjectField,
} from "./object-file-fields";
import styles from "./objects.module.css";

export interface FileObjectState {
  active: boolean;
  payload?: ReturnType<typeof buildFileObjectFields>;
}

export function ObjectFileFieldsForm({
  disabled,
  onChange,
}: {
  disabled: boolean;
  onChange: (state: FileObjectState) => void;
}) {
  const [file, setFile] = useState<File>();
  const [source, setSource] = useState<ImportFile>();
  const [sheetName, setSheetName] = useState("");
  const [encoding, setEncoding] = useState<CsvEncoding>("auto");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [fields, setFields] = useState<FileObjectField[]>([]);
  const [rowCount, setRowCount] = useState(0);
  const [titleFieldKey, setTitleFieldKey] = useState("");
  const request = useRef(0);
  const stopped = useRef(false);
  useEffect(() => {
    stopped.current = false;
    return () => {
      stopped.current = true;
    };
  }, []);

  const review = useMemo(() => {
    if (!file || loading || error) return {};
    try {
      return { payload: buildFileObjectFields(fields, titleFieldKey) };
    } catch (caught) {
      return {
        error: caught instanceof Error ? caught.message : "请核对字段配置。",
      };
    }
  }, [file, loading, error, fields, titleFieldKey]);
  useEffect(() => {
    onChange({ active: !!file, payload: review.payload });
  }, [file, review.payload, onChange]);

  function showSheet(next: ImportFile, name: string) {
    const sheet = next.sheet(name);
    const suggested = suggestObjectFields(sheet);
    setFields(suggested);
    setRowCount(sheet.rows.length);
    setTitleFieldKey(
      suggested.find((f) =>
        (TITLE_FIELD_TYPES as readonly string[]).includes(f.type),
      )?.fieldKey ?? "",
    );
  }

  function fileError(caught: unknown) {
    const message = caught instanceof Error ? caught.message : "";
    setError(
      message === "CSV_UNCLOSED_QUOTE"
        ? "CSV 引号未闭合，请检查文件。"
        : message === "名单列数与表头不一致"
          ? "数据列数超过表头，请检查文件。"
          : caught instanceof TypeError || caught instanceof DOMException
            ? "文件读取失败，请重新选择文件。"
            : message || "文件读取失败，请重新选择文件。",
    );
  }

  async function loadFile(nextFile: File, nextEncoding: CsvEncoding) {
    const id = ++request.current;
    onChange({ active: true });
    setFile(nextFile);
    setEncoding(nextEncoding);
    setSource(undefined);
    setError(undefined);
    setFields([]);
    setLoading(true);
    try {
      const next = await readImportFile(nextFile, nextEncoding);
      if (id !== request.current || stopped.current) return;
      setSource(next);
      const name = next.sheetNames[0] ?? "";
      setSheetName(name);
      showSheet(next, name);
    } catch (caught) {
      if (id === request.current && !stopped.current) fileError(caught);
    } finally {
      if (id === request.current && !stopped.current) setLoading(false);
    }
  }

  function update(index: number, next: Partial<FileObjectField>) {
    setFields((current) =>
      current.map((field, i) => (i === index ? { ...field, ...next } : field)),
    );
  }
  function changeType(index: number, type: FileFieldType) {
    setFields((current) =>
      current.map((field, i) =>
        i === index ? changeFileFieldType(field, type) : field,
      ),
    );
  }
  const titleFields = fields.filter(
    (f) =>
      f.included && (TITLE_FIELD_TYPES as readonly string[]).includes(f.type),
  );

  return (
    <section className={styles.fileCreate} aria-label="从文件生成字段">
      <h2>从 Excel / CSV 生成字段</h2>
      <Typography.Paragraph type="secondary">
        已有表格可以直接上传，核对下面的字段后创建。也可以不上传，先建空表再添加字段。
      </Typography.Paragraph>
      <input
        type="file"
        accept=".xlsx,.xls,.csv"
        aria-label="上传 Excel / CSV 生成字段"
        disabled={disabled}
        onChange={(event) => {
          const chosen = event.target.files?.[0];
          event.target.value = "";
          if (chosen) void loadFile(chosen, "auto");
        }}
      />
      {file ? (
        <>
          <Space wrap className={styles.fileCreateControls}>
            <Typography.Text>{file.name}</Typography.Text>
            <Button
              disabled={disabled}
              onClick={() => {
                ++request.current;
                setFile(undefined);
                setSource(undefined);
                setFields([]);
                setError(undefined);
                setLoading(false);
                onChange({ active: false });
              }}
            >
              移除文件，手工建表
            </Button>
          </Space>
          {!source?.sheetNames.length ? (
            <label className={styles.fileCreateControl}>
              <span>文件编码</span>
              <Select
                aria-label="建表文件编码"
                value={encoding}
                disabled={disabled || loading}
                onChange={(value: CsvEncoding) => void loadFile(file, value)}
                options={[
                  { value: "auto", label: "自动识别" },
                  { value: "utf-8", label: "UTF-8" },
                  { value: "gb18030", label: "GBK / GB18030" },
                ]}
              />
            </label>
          ) : null}
          {source?.encoding ? (
            <Typography.Paragraph type="secondary">
              当前按 {source.encoding} 读取，请核对样例中的中文。
            </Typography.Paragraph>
          ) : null}
          {source?.sheetNames.length ? (
            <label className={styles.fileCreateControl}>
              <span>工作表</span>
              <Select
                aria-label="建表工作表"
                value={sheetName}
                disabled={disabled || loading}
                options={source.sheetNames.map((name) => ({
                  value: name,
                  label: name,
                }))}
                onChange={(name) => {
                  setSheetName(name);
                  setError(undefined);
                  setFields([]);
                  try {
                    showSheet(source, name);
                  } catch (caught) {
                    fileError(caught);
                  }
                }}
              />
            </label>
          ) : null}
          {loading ? (
            <Typography.Paragraph>正在读取文件并识别字段…</Typography.Paragraph>
          ) : null}
          {error ? <Alert type="error" showIcon title={error} /> : null}
          {!loading && !error && fields.length ? (
            <>
              <Typography.Paragraph>
                已识别 {fields.length} 列 · {rowCount} 行数据
              </Typography.Paragraph>
              <Typography.Paragraph type="secondary">
                类型根据整列内容建议，可逐项修改。标题字段会设为必填；其他字段的必填要求由你决定。
              </Typography.Paragraph>
              {fields.some((f) => f.label !== f.sourceHeader.trim()) ? (
                <Alert
                  type="info"
                  showIcon
                  title="空表头或重名列已生成不同名称，可自行修改；后续导入原文件时请核对字段映射。"
                />
              ) : null}
              <div className={styles.fileCreateFields}>
                {fields.map((field, index) => (
                  <div key={field.fieldKey} className={styles.fileCreateField}>
                    <div className={styles.fileCreateFieldRow}>
                      <Checkbox
                        aria-label={`保留第 ${index + 1} 列`}
                        checked={field.included}
                        disabled={disabled}
                        onChange={(event) =>
                          update(index, { included: event.target.checked })
                        }
                      >
                        第 {index + 1} 列
                      </Checkbox>
                      <Input
                        aria-label={`第 ${index + 1} 列字段名称`}
                        value={field.label}
                        disabled={disabled || !field.included}
                        maxLength={100}
                        onChange={(event) =>
                          update(index, { label: event.target.value })
                        }
                      />
                      <Select
                        aria-label={`第 ${index + 1} 列字段类型`}
                        value={field.type}
                        disabled={disabled || !field.included}
                        options={PUBLISHED_FIELD_TYPES.filter(
                          (type) => type !== "MEMBER",
                        ).map((type) => ({
                          value: type,
                          label: FIELD_TYPE_LABELS[type],
                        }))}
                        onChange={(type: FileFieldType) =>
                          changeType(index, type)
                        }
                      />
                      <Checkbox
                        aria-label={`第 ${index + 1} 列必填`}
                        checked={
                          field.fieldKey === titleFieldKey || field.required
                        }
                        disabled={
                          disabled ||
                          !field.included ||
                          field.fieldKey === titleFieldKey
                        }
                        onChange={(event) =>
                          update(index, { required: event.target.checked })
                        }
                      >
                        必填
                      </Checkbox>
                    </div>
                    <Typography.Paragraph type="secondary">
                      原列：{field.sourceHeader || "空表头"} · 样例：
                      {field.values
                        .slice(0, 3)
                        .map((v) => (v.length > 80 ? v.slice(0, 80) + "…" : v))
                        .join(" / ") || "无非空数据"}
                    </Typography.Paragraph>
                    <Typography.Paragraph type="secondary">
                      {field.reason}
                    </Typography.Paragraph>
                    {field.included &&
                    field.type === "TEXT" &&
                    field.suggestedType ? (
                      <Button
                        disabled={disabled}
                        onClick={() => changeType(index, field.suggestedType!)}
                        aria-label={`将${field.label}设为${FIELD_TYPE_LABELS[field.suggestedType]}`}
                      >
                        采纳{FIELD_TYPE_LABELS[field.suggestedType]}建议
                      </Button>
                    ) : null}
                    {field.included &&
                    (field.type === "SINGLE_SELECT" ||
                      field.type === "MULTI_SELECT") ? (
                      <label className={styles.fileCreateOptions}>
                        <span>选项（每行一个，可修改，最多 100 个）</span>
                        <Input.TextArea
                          aria-label={`第 ${index + 1} 列选项`}
                          value={field.optionText}
                          disabled={disabled}
                          autoSize={{ minRows: 2, maxRows: 5 }}
                          onChange={(event) =>
                            update(index, { optionText: event.target.value })
                          }
                        />
                      </label>
                    ) : null}
                  </div>
                ))}
              </div>
              <label className={styles.fileCreateControl}>
                <span>记录标题字段（必填）</span>
                <Select
                  aria-label="记录标题字段"
                  value={
                    titleFields.some((f) => f.fieldKey === titleFieldKey)
                      ? titleFieldKey
                      : undefined
                  }
                  disabled={disabled}
                  placeholder="选择能识别一条记录的字段"
                  options={titleFields.map((f) => ({
                    value: f.fieldKey,
                    label: f.label,
                  }))}
                  onChange={setTitleFieldKey}
                />
              </label>
              {review.error ? (
                <Alert type="error" showIcon title={review.error} />
              ) : null}
              <Alert
                type="info"
                showIcon
                title="确认后只创建业务表结构草稿。请在设计器核对员工权限并发布，再从业务表的导入入口导入原文件数据。"
              />
            </>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
