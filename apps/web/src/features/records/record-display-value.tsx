import type { ReactNode } from "react";
import {
  selectOptions,
  type PublishedFieldView,
} from "@/features/objects/object-types";
import { OptionBadge } from "@/features/objects/option-badge";
import type { DynamicFieldMember } from "./dynamic-field";
import styles from "./records.module.css";

export function displayValue(
  field: Pick<PublishedFieldView, "type" | "config" | "validation">,
  value: unknown,
  members: DynamicFieldMember[],
): ReactNode {
  if (value === null || value === undefined || value === "") return "—";
  switch (field.type) {
    case "BOOLEAN":
      return value === true ? "是" : "否";
    case "SINGLE_SELECT":
      return optionValue(field, String(value));
    case "MULTI_SELECT":
      return (
        <span className={styles.optionValues}>
          {(Array.isArray(value) ? value : []).map((key) =>
            optionValue(field, String(key)),
          )}
        </span>
      );
    case "MEMBER":
      return (
        members.find((member) => member.id === value)?.displayName ??
        String(value)
      );
    case "DATETIME":
      return formatDateTime(String(value));
    case "NUMBER":
    case "MONEY": {
      const number = Number(value);
      if (!Number.isFinite(number)) return "—";
      return new Intl.NumberFormat("zh-CN", {
        maximumFractionDigits: field.validation.scale ?? 2,
        ...(field.type === "MONEY"
          ? { minimumFractionDigits: field.validation.scale ?? 2 }
          : {}),
      }).format(number);
    }
    default:
      return String(value);
  }
}

function optionValue(
  field: Pick<PublishedFieldView, "type" | "config" | "validation">,
  key: string,
): ReactNode {
  const option = selectOptions(field).find(
    (candidate) => candidate.key === key,
  );
  if (!option) return key;
  return <OptionBadge key={key} option={option} />;
}

export function formatDateTime(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  const date = new Date(timestamp);
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
