"use client";

import { MenuOutlined } from "@ant-design/icons";
import type { ReactNode } from "react";

import styles from "./app-shell.module.css";

/**
 * Holds the navigation trigger for compact screens. On a desktop it only
 * appears when the shell supplies leading content such as a breadcrumb; the
 * workspace identity and the account menu live in the sidebar.
 */
export function TopHeader({
  brand,
  headerLeft,
  onOpenNavigation,
}: {
  brand: string;
  headerLeft?: ReactNode;
  onOpenNavigation: () => void;
}) {
  return (
    <header
      className={`${styles.header} ${headerLeft ? "" : styles.headerCompactOnly}`}
    >
      <div className={styles.headerLeading}>
        <button
          type="button"
          className={styles.mobileMenuButton}
          aria-label="打开导航"
          onClick={onOpenNavigation}
        >
          <MenuOutlined />
        </button>
        <div>{headerLeft ?? <span>{brand}</span>}</div>
      </div>
    </header>
  );
}
