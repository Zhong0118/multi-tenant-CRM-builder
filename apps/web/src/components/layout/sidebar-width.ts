export const SIDEBAR_MIN_WIDTH = 200;
export const SIDEBAR_MAX_WIDTH = 320;
export const SIDEBAR_DEFAULT_WIDTH = 224;
export const SIDEBAR_COLLAPSED_WIDTH = 64;
export const SIDEBAR_COLLAPSE_BELOW = 176;

export const SIDEBAR_WIDTH_KEY = "crm.sidebar.width";
export const SIDEBAR_COLLAPSED_KEY = "crm.sidebar.collapsed";

export interface SidebarLayout {
  collapsed: boolean;
  width: number;
}

export function clampSidebarWidth(value: number): number {
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(value)));
}

export function parseSidebarWidth(value: string | null): number {
  if (value == null) return SIDEBAR_DEFAULT_WIDTH;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return SIDEBAR_DEFAULT_WIDTH;
  return clampSidebarWidth(parsed);
}

export function resolveSidebarDrag(
  pointerX: number,
  current: SidebarLayout,
): SidebarLayout {
  if (current.collapsed) {
    if (pointerX < SIDEBAR_MIN_WIDTH) {
      return current;
    }
    return { collapsed: false, width: clampSidebarWidth(pointerX) };
  }

  if (pointerX < SIDEBAR_COLLAPSE_BELOW) {
    return { collapsed: true, width: current.width };
  }

  return { collapsed: false, width: clampSidebarWidth(pointerX) };
}
