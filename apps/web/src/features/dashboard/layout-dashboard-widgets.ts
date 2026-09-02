export type DashboardLayoutWidgetType =
  | "METRIC"
  | "STATUS_DISTRIBUTION"
  | "TREND"
  | "LEADERBOARD"
  | "RECORD_LIST";

export interface DashboardLayoutWidget {
  id: string;
  type: DashboardLayoutWidgetType;
  sortOrder: number;
}

export interface DashboardWidgetLayout<T extends DashboardLayoutWidget> {
  metrics: T[];
  primaryTrend: T | null;
  extraTrends: T[];
  distributions: T[];
  leaderboards: T[];
  recordLists: T[];
}

export function layoutDashboardWidgets<T extends DashboardLayoutWidget>(
  widgets: T[],
): DashboardWidgetLayout<T> {
  const sorted = widgets
    .map((widget, index) => ({ widget, index }))
    .sort(
      (left, right) =>
        left.widget.sortOrder - right.widget.sortOrder || left.index - right.index,
    )
    .map(({ widget }) => widget);

  const metrics = ofType(sorted, "METRIC");
  const trends = ofType(sorted, "TREND");
  const [primaryTrend = null, ...extraTrends] = trends;

  return {
    metrics,
    primaryTrend,
    extraTrends,
    distributions: ofType(sorted, "STATUS_DISTRIBUTION"),
    leaderboards: ofType(sorted, "LEADERBOARD"),
    recordLists: ofType(sorted, "RECORD_LIST"),
  };
}

function ofType<T extends DashboardLayoutWidget>(
  widgets: T[],
  type: DashboardLayoutWidgetType,
): T[] {
  return widgets.filter((widget) => widget.type === type);
}
