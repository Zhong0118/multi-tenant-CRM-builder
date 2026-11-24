import type { ReactNode } from "react";

import { MemberIdentity } from "@/components/identity/member-identity";
import {
  selectOptions,
  type PublishedFieldView,
} from "@/features/objects/object-types";
import { OptionBadge } from "@/features/objects/option-badge";
import type { DynamicFieldMember } from "./dynamic-field";
import styles from "./records.module.css";

/** The owner as an identity: avatar and name, 未指定, or 其他成员 — never an id. */
export function RecordOwner({
  ownerMemberId,
  members,
  currentMemberId,
  size = "sm",
}: {
  ownerMemberId: string | null | undefined;
  members: DynamicFieldMember[];
  currentMemberId?: string;
  size?: "sm" | "md";
}) {
  return (
    <MemberIdentity
      size={size}
      member={
        ownerMemberId
          ? members.find((candidate) => candidate.id === ownerMemberId)
          : undefined
      }
      memberId={ownerMemberId ?? null}
      currentMemberId={currentMemberId}
    />
  );
}

export function displayValue(
  field: Pick<PublishedFieldView, "type" | "config" | "validation">,
  value: unknown,
  members: DynamicFieldMember[],
  timeZone?: string,
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
        <MemberIdentity
          size="sm"
          member={members.find((member) => member.id === value)}
          memberId={String(value)}
        />
      );
    case "DATETIME":
      return formatDateTime(String(value), timeZone);
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

export function formatDateTime(value: string, timeZone?: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(timestamp);
}
