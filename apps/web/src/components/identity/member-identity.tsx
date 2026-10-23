import type { ReactNode } from "react";

import styles from "./member-identity.module.css";

/** The member fields the identity needs; every roster in the app has these. */
export interface IdentityMember {
  id: string;
  displayName: string | null;
  status?: "ACTIVE" | "DISABLED";
  /** No API returns one yet; used as soon as one does. */
  avatarUrl?: string | null;
}

export type MemberIdentitySize = "sm" | "md" | "lg";

/**
 * The first readable character of a name: the surname of a Chinese name, the
 * initial of a Latin one. Leading symbols, emoji and spaces are skipped; a name
 * with nothing readable gets "?".
 */
export function memberInitial(name: string | null | undefined): string {
  const text = (name ?? "").trim();
  const match = text.match(/[\p{Script=Han}]|\p{L}|\p{N}/u);
  if (!match) return "?";
  return match[0].toLocaleUpperCase("zh-CN");
}

/* Calm, non-status hues (no red, green or amber, which mean something else
   here), each a light background with a dark ink of at least 4.5:1. */
const AVATAR_TONES = [
  ["#DCEBFE", "#1E40AF"],
  ["#E0E7FF", "#3730A3"],
  ["#EDE9FE", "#5B21B6"],
  ["#F3E8FF", "#6B21A8"],
  ["#FCE7F3", "#9D174D"],
  ["#CFFAFE", "#155E75"],
  ["#CCFBF1", "#115E59"],
  ["#E0F2FE", "#075985"],
  ["#E2E8F0", "#334155"],
] as const;

/** A stable index from the member id (FNV-1a), so a colour never changes. */
export function avatarTone(id: string): readonly [string, string] {
  let hash = 0x811c9dc5;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return AVATAR_TONES[(hash >>> 0) % AVATAR_TONES.length];
}

export function memberName(
  member: Pick<IdentityMember, "displayName">,
): string {
  return member.displayName?.trim() || "未设置姓名";
}

function Avatar({
  seed,
  label,
  size,
  imageUrl,
  variant = "member",
}: {
  seed: string;
  label: string;
  size: MemberIdentitySize;
  imageUrl?: string | null;
  variant?: "member" | "placeholder";
}) {
  const [background, color] =
    variant === "member" ? avatarTone(seed) : ["", ""];
  return (
    <span
      className={styles.avatar}
      data-size={size}
      data-variant={variant}
      style={variant === "member" ? { background, color } : undefined}
      aria-hidden
    >
      {imageUrl ? (
        // A 20–32px decorative avatar from any host; next/image would need
        // every avatar origin configured for no visible gain.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={imageUrl} alt="" />
      ) : (
        label
      )}
    </span>
  );
}

/**
 * One way to show a person everywhere: an avatar beside the full name. The
 * avatar never replaces the name, an unassigned owner says so, a disabled
 * member says so in words, and a member the viewer may not see stays
 * anonymous rather than showing an id.
 */
export function MemberIdentity({
  member,
  memberId,
  currentMemberId,
  size = "md",
  unassignedLabel = "未指定",
  suffix,
}: {
  /** The member, when the viewer's roster has them. */
  member?: IdentityMember | null;
  /** The id being shown, for members outside the roster; null means unassigned. */
  memberId?: string | null;
  currentMemberId?: string;
  size?: MemberIdentitySize;
  unassignedLabel?: string;
  suffix?: ReactNode;
}) {
  const id = member?.id ?? memberId ?? null;
  if (!id) {
    return (
      <span
        className={styles.identity}
        data-size={size}
        data-state="unassigned"
      >
        <Avatar seed="" label="" size={size} variant="placeholder" />
        <span className={styles.name}>{unassignedLabel}</span>
      </span>
    );
  }
  if (!member) {
    const self = id === currentMemberId;
    return (
      <span
        className={styles.identity}
        data-size={size}
        data-state={self ? "self" : "unknown"}
      >
        <Avatar
          seed={id}
          label={self ? "我" : "?"}
          size={size}
          variant={self ? "member" : "placeholder"}
        />
        <span className={styles.name}>{self ? "我" : "其他成员"}</span>
        {suffix}
      </span>
    );
  }
  const name = memberName(member);
  const disabled = member.status === "DISABLED";
  return (
    <span
      className={styles.identity}
      data-size={size}
      data-state={disabled ? "disabled" : "member"}
      title={disabled ? `${name}（已停用）` : name}
    >
      <Avatar
        seed={member.id}
        label={memberInitial(member.displayName)}
        size={size}
        imageUrl={member.avatarUrl}
      />
      <span className={styles.name}>
        {name}
        {member.id === currentMemberId ? (
          <span className={styles.self}>（我）</span>
        ) : null}
      </span>
      {disabled ? <span className={styles.status}>已停用</span> : null}
      {suffix}
    </span>
  );
}

/**
 * Options for a member picker: identities as labels, the plain name for
 * search. Disabled members cannot be chosen, but a disabled member who is the
 * current value stays visible (and marked) instead of turning into a raw id.
 */
export function memberSelectOptions(
  members: IdentityMember[],
  {
    selected,
    includeDisabled = false,
    currentMemberId,
  }: {
    selected?: string | string[] | null;
    includeDisabled?: boolean;
    currentMemberId?: string;
  } = {},
) {
  const selectedIds = new Set(
    Array.isArray(selected) ? selected : selected ? [selected] : [],
  );
  return members
    .filter(
      (member) =>
        includeDisabled ||
        member.status !== "DISABLED" ||
        selectedIds.has(member.id),
    )
    .map((member) => ({
      value: member.id,
      searchText: memberName(member),
      disabled: !includeDisabled && member.status === "DISABLED",
      label: (
        <MemberIdentity
          member={member}
          size="sm"
          currentMemberId={currentMemberId}
        />
      ),
    }));
}
