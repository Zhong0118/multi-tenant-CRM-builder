import type { ParsedCsv } from "@/lib/csv";
import { TITLE_FIELD_TYPES, type PublishedFieldType } from "./object-types";

export type FileFieldType = Exclude<PublishedFieldType, "MEMBER">;
export interface FileObjectField {
  fieldKey: string;
  sourceHeader: string;
  label: string;
  type: FileFieldType;
  required: boolean;
  included: boolean;
  values: string[];
  reason: string;
  suggestedType?: "SINGLE_SELECT" | "MULTI_SELECT";
  optionText: string;
}

export function suggestObjectFields(sheet: ParsedCsv): FileObjectField[] {
  const labels = new Set<string>();
  const sourceLabels = new Set(
    sheet.headers.map((header) => header.trim().toLowerCase()),
  );
  let sequence = 0;
  return sheet.headers.map((header, index) => {
    const base = header.trim() || `未命名列 ${index + 1}`;
    let label = base;
    for (let suffix = 2; labels.has(label); suffix++)
      label = `${base}（${suffix}）`;
    labels.add(label);
    const values = [
      ...new Set(
        sheet.rows.map((row) => (row[index] ?? "").trim()).filter(Boolean),
      ),
    ];
    let fieldKey: string;
    do {
      fieldKey = `col_${++sequence}`;
    } while (sourceLabels.has(fieldKey));
    return {
      fieldKey,
      sourceHeader: header,
      label,
      included: true,
      required: false,
      values,
      optionText: "",
      ...inferType(header, values),
    };
  });
}

function inferType(
  header: string,
  values: string[],
): Pick<FileObjectField, "type" | "reason" | "suggestedType"> {
  if (!values.length) return { type: "TEXT", reason: "整列为空，先保留为文本" };
  if (
    /(手机|电话|号码|编号|编码|身份证|证件|邮编|账号|帐号|主号|卡号|工号|学号|订单号|单号|\b(phone|mobile|id|code|zip|account)\b)/i.test(
      header,
    )
  )
    return { type: "TEXT", reason: "标识或联系电话，保留原始字符和前导零" };
  if (values.some((v) => v.length > 300 || v.includes("\n")))
    return { type: "TEXTAREA", reason: "包含较长文字或换行" };
  if (values.every((v) => validDate(v, false)))
    return { type: "DATE", reason: "所有非空值都是有效的年月日" };
  if (values.every((v) => validDate(v, true)))
    return { type: "DATETIME", reason: "所有非空值都是有效的日期时间" };
  if (
    values.every((v) =>
      ["是", "否", "true", "false", "yes", "no"].includes(v.toLowerCase()),
    )
  )
    return { type: "BOOLEAN", reason: "所有非空值都是明确的是/否" };
  if (values.every((v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)))
    return { type: "EMAIL", reason: "所有非空值符合邮箱格式" };
  const numeric = values.every(
    (v) =>
      /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(v) &&
      v.replace(/[-.]/g, "").length <= 15 &&
      Number.isFinite(Number(v)),
  );
  if (numeric) {
    if (
      /(金额|价格|费用|单价|成本|收入|支出|price|amount|cost)/i.test(header) &&
      values.every((v) => (v.split(".")[1]?.length ?? 0) <= 2)
    )
      return { type: "MONEY", reason: "金额相关表头，所有值最多两位小数" };
    return {
      type: "NUMBER",
      reason: "所有非空值都是数字，无前导零或长数字标识",
    };
  }
  if (
    /(状态|类别|类型|分类|等级|阶段|标签|status|category|type|level|stage|tags)/i.test(
      header,
    )
  ) {
    const multi = values.some((v) => /[;；,，]/.test(v));
    const options = optionLabels(
      values,
      multi ? "MULTI_SELECT" : "SINGLE_SELECT",
    );
    if (
      options.length > 0 &&
      options.length <= 20 &&
      options.every((v) => v.length <= 100)
    )
      return {
        type: "TEXT",
        suggestedType: multi ? "MULTI_SELECT" : "SINGLE_SELECT",
        reason: `检测到 ${options.length} 个分类值，可确认后设为${multi ? "多选" : "单选"}`,
      };
  }
  return { type: "TEXT", reason: "保留为文本，避免混合内容被错误转换" };
}

function validDate(value: string, withTime: boolean): boolean {
  if (
    withTime &&
    !(
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(?::\d{2})?$/.test(value) ||
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?Z$/.test(value)
    )
  )
    return false;
  const match = (
    withTime
      ? /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(Z)?$/
      : /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/
  ).exec(value);
  if (!match) return false;
  const [year, month, day] = match.slice(1, 4).map(Number);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  return (
    year >= 1000 &&
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day &&
    (!withTime ||
      (Number(match[4]) < 24 &&
        Number(match[5]) < 60 &&
        Number(match[6] ?? 0) < 60))
  );
}

function optionLabels(values: string[], type: FileFieldType): string[] {
  return [
    ...new Set(
      values
        .flatMap((value) =>
          type === "MULTI_SELECT" ? value.split(/[;；,，]/) : [value],
        )
        .map((v) => v.trim())
        .filter(Boolean),
    ),
  ];
}

export function changeFileFieldType(
  field: FileObjectField,
  type: FileFieldType,
): FileObjectField {
  const options =
    type === "SINGLE_SELECT" || type === "MULTI_SELECT"
      ? optionLabels(field.values, type)
      : [];
  return {
    ...field,
    type,
    optionText:
      options.length <= 100 && options.every((v) => v.length <= 100)
        ? options.join("\n")
        : "",
  };
}

export function buildFileObjectFields(
  fields: FileObjectField[],
  titleFieldKey: string,
) {
  const included = fields.filter((f) => f.included);
  if (!included.length) throw new Error("至少保留一个字段。");
  const title = included.find((f) => f.fieldKey === titleFieldKey);
  if (!title || !(TITLE_FIELD_TYPES as readonly string[]).includes(title.type))
    throw new Error("请选择标题字段；至少需要一列文本、电话、邮箱或单选字段。");
  const labels = included.map((f) => f.label.trim());
  if (labels.some((label) => !label || label.length > 100))
    throw new Error("字段名称不能为空，且最多 100 个字符。");
  if (new Set(labels).size !== labels.length)
    throw new Error("字段名称重复，请修改后再创建。");
  return {
    titleFieldKey,
    initialFields: included.map((field) => {
      let config = {};
      if (field.type === "SINGLE_SELECT" || field.type === "MULTI_SELECT") {
        const options = field.optionText
          .split("\n")
          .map((v) => v.trim())
          .filter(Boolean);
        if (!options.length)
          throw new Error(
            `${field.label}：请填写选项，每行一个。超过 100 项时建议保留为文本。`,
          );
        if (options.length > 100 || options.some((v) => v.length > 100))
          throw new Error(
            `${field.label}：最多 100 个选项，每项最多 100 个字符。`,
          );
        if (new Set(options).size !== options.length)
          throw new Error(`${field.label}：选项重复，请合并重复项。`);
        const reserved = new Set(options);
        let sequence = 0;
        config = {
          options: options.map((label) => {
            let key: string;
            do {
              key = `option_${++sequence}`;
            } while (reserved.has(key));
            return { key, label, status: "ACTIVE" as const };
          }),
        };
      }
      return {
        fieldKey: field.fieldKey,
        label: field.label.trim(),
        type: field.type,
        required: field.fieldKey === titleFieldKey || field.required,
        defaultValue: null,
        validation: {},
        config,
      };
    }),
  };
}
