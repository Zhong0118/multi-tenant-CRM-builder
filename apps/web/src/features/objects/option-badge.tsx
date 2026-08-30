import type { SelectOptionView } from "./object-types";

import styles from "./option-badge.module.css";

export function OptionBadge({
  option,
}: {
  option: Pick<SelectOptionView, "label" | "status" | "color">;
}) {
  return (
    <span
      className={styles.badge}
      data-option-color={option.color}
      data-inactive={option.status === "INACTIVE" ? "true" : undefined}
    >
      <span className={styles.dot} aria-hidden />
      {option.label}
      {option.status === "INACTIVE" ? (
        <span className={styles.inactive}>已停用</span>
      ) : null}
    </span>
  );
}
