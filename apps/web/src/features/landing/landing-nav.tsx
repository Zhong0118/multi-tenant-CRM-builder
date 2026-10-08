"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { LogoMark } from "./logo-mark";
import styles from "./landing.module.css";

export const SECTION_LINKS = [
  { href: "#demo", label: "业务过程" },
  { href: "#fields", label: "灵活字段" },
  { href: "#team", label: "团队协作" },
  { href: "#ai", label: "AI 助手" },
  { href: "#faq", label: "常见问题" },
] as const;

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
    // The menu only exists below the tablet breakpoint; widening the window
    // must not leave the page locked behind an invisible open menu.
    const wide = window.matchMedia("(min-width: 960px)");
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
          {SECTION_LINKS.map((link) => (
            <a key={link.href} href={link.href}>
              {link.label}
            </a>
          ))}
        </nav>

        <Link href="/login" className={styles.navLogin}>
          登录工作区
        </Link>

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

      <div id="landing-menu" className={styles.menuPanel} hidden={!open}>
        <nav aria-label="页面导航（菜单）">
          {SECTION_LINKS.map((link) => (
            <a key={link.href} href={link.href} onClick={() => setOpen(false)}>
              {link.label}
            </a>
          ))}
        </nav>
        <div className={styles.menuActions}>
          <Link href="/login" className={styles.buttonPrimary}>
            登录工作区
          </Link>
          <Link href="/register" className={styles.menuInvite}>
            已收到邀请？用受邀手机号创建账号
          </Link>
        </div>
      </div>
    </header>
  );
}
