import type { ReactNode } from "react";

import styles from "./surface.module.css";

export interface SurfaceProps {
  children: ReactNode;
  className?: string;
  ariaLabel?: string;
}

function classes(base: string, className?: string) {
  return className ? `${base} ${className}` : base;
}

export function DataPanel({
  children,
  className,
  ariaLabel,
}: SurfaceProps) {
  return (
    <section
      aria-label={ariaLabel}
      className={classes(styles.dataPanel, className)}
      data-surface="data"
    >
      {children}
    </section>
  );
}

export function ReadingPanel({
  children,
  className,
  ariaLabel,
}: SurfaceProps) {
  return (
    <section
      aria-label={ariaLabel}
      className={classes(styles.readingPanel, className)}
      data-surface="reading"
    >
      {children}
    </section>
  );
}
