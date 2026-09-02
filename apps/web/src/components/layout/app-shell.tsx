"use client";

import { usePathname } from "next/navigation";
import {
  useCallback,
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
  return window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true";
}

function getCollapsedServerSnapshot() {
  return false;
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
  const collapsed = useSyncExternalStore(
    subscribeCollapsed,
    getCollapsedSnapshot,
    getCollapsedServerSnapshot,
  );
  const width = useSyncExternalStore(
    subscribeWidth,
    getWidthSnapshot,
    getWidthServerSnapshot,
  );
  const layoutRef = useRef({ collapsed, width });
  layoutRef.current = { collapsed, width };

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
    <div className={styles.shell}>
      {mobileOpen ? (
        <button
          type="button"
          className={styles.backdrop}
          aria-label="关闭导航"
          onClick={() => setMobileOpen(false)}
        />
      ) : null}
      <Sidebar
        brand={brand}
        brandHref={brandHref}
        navGroups={navGroups}
        pathname={pathname}
        collapsed={mobileOpen ? false : collapsed}
        width={width}
        resizing={resizing}
        onToggle={toggleCollapsed}
        mobileOpen={mobileOpen}
        onMobileClose={() => setMobileOpen(false)}
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
          onOpenNavigation={() => setMobileOpen(true)}
        />
        <main className={styles.main} data-scroll-region="main">
          {children}
        </main>
      </div>
    </div>
  );
}
