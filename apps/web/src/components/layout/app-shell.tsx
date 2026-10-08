"use client";

import { usePathname } from "next/navigation";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type PointerEvent,
  type ReactNode,
} from "react";

import { Sidebar } from "./sidebar";
import { TopHeader } from "./top-header";
import styles from "./app-shell.module.css";
import {
  SIDEBAR_COLLAPSED_KEY,
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_WIDTH_KEY,
  parseSidebarWidth,
  resolveSidebarDrag,
} from "./sidebar-width";

export interface ShellUser {
  displayName: string;
  phone: string;
  isPlatformAdmin: boolean;
}

export interface ShellNavItem {
  href: string;
  label: string;
  icon?: ReactNode;
}

export interface ShellNavGroup {
  ariaLabel: string;
  items: ShellNavItem[];
  emptyLabel?: string;
  emptyHref?: string;
  emptyActionLabel?: string;
}

export interface AppShellProps {
  brand: string;
  brandIcon?: ReactNode;
  brandHref: string;
  navGroups: ShellNavGroup[];
  headerLeft: ReactNode;
  user: ShellUser;
  roleLabel: string;
  showWorkspaceSwitch?: boolean;
  children: ReactNode;
}

const collapsedListeners = new Set<() => void>();
const widthListeners = new Set<() => void>();

function subscribeCollapsed(listener: () => void) {
  collapsedListeners.add(listener);
  return () => {
    collapsedListeners.delete(listener);
  };
}

function getCollapsedSnapshot() {
  const preference = window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY);
  return preference === "true" ? true : preference === "false" ? false : null;
}

function getCollapsedServerSnapshot() {
  return null;
}

function subscribeViewport(listener: () => void) {
  window.addEventListener("resize", listener);
  return () => window.removeEventListener("resize", listener);
}

function getViewportSnapshot() {
  return window.innerWidth < 768 ? "mobile" : window.innerWidth < 1200 ? "compact" : "desktop";
}

function getViewportServerSnapshot() {
  return "desktop";
}

function subscribeWidth(listener: () => void) {
  widthListeners.add(listener);
  return () => {
    widthListeners.delete(listener);
  };
}

function getWidthSnapshot() {
  return parseSidebarWidth(window.localStorage.getItem(SIDEBAR_WIDTH_KEY));
}

function getWidthServerSnapshot() {
  return SIDEBAR_DEFAULT_WIDTH;
}

function persistCollapsed(collapsed: boolean) {
  const next = String(collapsed);
  if (window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === next) return;
  window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next);
  collapsedListeners.forEach((listener) => listener());
}

function persistWidth(width: number) {
  const next = String(width);
  if (window.localStorage.getItem(SIDEBAR_WIDTH_KEY) === next) return;
  window.localStorage.setItem(SIDEBAR_WIDTH_KEY, next);
  widthListeners.forEach((listener) => listener());
}

export function AppShell({
  brand,
  brandIcon,
  brandHref,
  navGroups,
  headerLeft,
  user,
  roleLabel,
  showWorkspaceSwitch = false,
  children,
}: AppShellProps) {
  const pathname = usePathname() ?? "";
  const [mobileOpen, setMobileOpen] = useState(false);
  const [resizing, setResizing] = useState(false);
  const dragging = useRef(false);
  const navigationTrigger = useRef<HTMLElement | null>(null);
  const shell = useRef<HTMLDivElement>(null);
  const viewport = useSyncExternalStore(subscribeViewport, getViewportSnapshot, getViewportServerSnapshot);
  const collapsedPreference = useSyncExternalStore(
    subscribeCollapsed,
    getCollapsedSnapshot,
    getCollapsedServerSnapshot,
  );
  const width = useSyncExternalStore(
    subscribeWidth,
    getWidthSnapshot,
    getWidthServerSnapshot,
  );
  const collapsed = viewport !== "mobile" && (collapsedPreference ?? viewport === "compact");
  const closeNavigation = useCallback(() => {
    setMobileOpen(false);
  }, []);

  useEffect(() => {
    if (!mobileOpen) return;
    const sidebar = shell.current?.querySelector<HTMLElement>("aside");
    const background = shell.current?.querySelector<HTMLElement>(`.${styles.column}`);
    background?.setAttribute("inert", "");
    sidebar?.querySelector<HTMLElement>("a")?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeNavigation();
      } else if (event.key === "Tab") {
        const controls = Array.from(sidebar?.querySelectorAll<HTMLElement>(
          'a[href], button:not(:disabled), [tabindex="0"]',
        ) ?? []).filter((element) => {
          for (let node: HTMLElement | null = element; node && node !== sidebar; node = node.parentElement) {
            const style = getComputedStyle(node);
            if (style.display === "none" || style.visibility === "hidden") return false;
          }
          return true;
        });
        const first = controls[0];
        const last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    const onResize = () => {
      if (window.innerWidth >= 768) closeNavigation();
    };
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", onResize);
      background?.removeAttribute("inert");
      if (window.innerWidth < 768) navigationTrigger.current?.focus();
      else sidebar?.querySelector<HTMLElement>("a")?.focus();
    };
  }, [mobileOpen, closeNavigation]);

  const layoutRef = useRef({ collapsed, width });
  useEffect(() => {
    layoutRef.current = { collapsed, width };
  }, [collapsed, width]);

  const toggleCollapsed = useCallback(() => {
    persistCollapsed(!collapsed);
  }, [collapsed]);

  const applyDrag = useCallback((pointerX: number) => {
    const next = resolveSidebarDrag(pointerX, layoutRef.current);
    layoutRef.current = next;
    persistWidth(next.width);
    persistCollapsed(next.collapsed);
  }, []);

  const onResizePointerDown = useCallback((event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    dragging.current = true;
    setResizing(true);
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      // jsdom and synthetic pointer events have no active pointer to capture.
    }
  }, []);

  const onResizePointerMove = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      if (!dragging.current) return;
      applyDrag(event.clientX);
    },
    [applyDrag],
  );

  const onResizePointerUp = useCallback((event: PointerEvent<HTMLElement>) => {
    dragging.current = false;
    setResizing(false);
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  const onResizeDoubleClick = useCallback(() => {
    persistWidth(SIDEBAR_DEFAULT_WIDTH);
    persistCollapsed(false);
  }, []);

  return (
    <div className={styles.shell} ref={shell}>
      {mobileOpen ? (
        <button
          type="button"
          className={styles.backdrop}
          aria-label="关闭导航"
          onClick={closeNavigation}
        />
      ) : null}
      <Sidebar
        brand={brand}
        brandIcon={brandIcon}
        brandHref={brandHref}
        navGroups={navGroups}
        pathname={pathname}
        collapsed={mobileOpen ? false : collapsed}
        width={width}
        resizing={resizing}
        onToggle={toggleCollapsed}
        mobileOpen={mobileOpen}
        onMobileClose={() => { if (mobileOpen) closeNavigation(); }}
        onResizePointerDown={onResizePointerDown}
        onResizePointerMove={onResizePointerMove}
        onResizePointerUp={onResizePointerUp}
        onResizeDoubleClick={onResizeDoubleClick}
      />
      <div className={styles.column}>
        <TopHeader
          headerLeft={headerLeft}
          user={user}
          roleLabel={roleLabel}
          showWorkspaceSwitch={showWorkspaceSwitch}
          onOpenNavigation={() => {
            navigationTrigger.current = shell.current?.querySelector<HTMLElement>("header button") ?? null;
            setMobileOpen(true);
          }}
        />
        <main className={styles.main} data-scroll-region="main">
          {children}
        </main>
      </div>
    </div>
  );
}
