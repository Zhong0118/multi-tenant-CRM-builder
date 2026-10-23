"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { NAV_LINKS } from "./content";
import { LogoMark } from "./logo-mark";
import styles from "./landing.module.css";

const WIDE = "(min-width: 760px)";

export function LandingNav() {
  const [open, setOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      toggleRef.current?.focus();
    };
    // The menu only exists on narrow screens; widening the window must not
    // leave an invisible menu open.
    const wide = window.matchMedia(WIDE);
    const onWide = () => {
      if (wide.matches) setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    wide.addEventListener("change", onWide);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      wide.removeEventListener("change", onWide);
    };
  }, [open]);

  return (
    <header className={styles.nav} data-open={open || undefined}>
      <div className={styles.navInner}>
        <Link href="/" className={styles.brand} aria-label="百杰 CRM 首页">
          <LogoMark className={styles.brandMark} />
          <span>百杰 CRM</span>
        </Link>

        <nav className={styles.navLinks} aria-label="页面导航">
          {NAV_LINKS.map((link) => (
            <a key={link.href} href={link.href}>
              {link.label}
            </a>
          ))}
        </nav>

        <div className={styles.navActions}>
          <Link href="/login" className={styles.navLogin}>
            登录
          </Link>
          <Link href="/register" className={styles.navRegister}>
            创建账号
          </Link>
        </div>

        <button
          ref={toggleRef}
          type="button"
          className={styles.menuToggle}
          aria-expanded={open}
          aria-controls="landing-menu"
          onClick={() => setOpen((value) => !value)}
        >
          <span className={styles.menuIcon} aria-hidden="true" />
          {open ? "收起" : "菜单"}
        </button>
      </div>

      <div
        id="landing-menu"
        className={styles.menuPanel}
        data-open={open || undefined}
        inert={!open}
      >
        <div>
          <nav aria-label="页面导航（菜单）">
            {NAV_LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                onClick={() => setOpen(false)}
              >
                {link.label}
              </a>
            ))}
          </nav>
          <div className={styles.menuActions}>
            <Link href="/register" className={styles.buttonPrimary}>
              创建账号
            </Link>
            <Link href="/login" className={styles.buttonSecondary}>
              登录工作区
            </Link>
          </div>
        </div>
      </div>
    </header>
  );
}
