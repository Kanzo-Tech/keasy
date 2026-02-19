export type ChartType = "bar" | "line" | "area" | "pie" | "scatter";

export interface ChartWidget {
  id: string;
  type: ChartType;
  title: string;
  xAxis: string;
  yAxis?: string;
  groupBy?: string;
  aggregation?: string;
}

export type DashboardColumns = 1 | 2 | 3;

export interface DashboardLayout {
  widgets: ChartWidget[];
  columns: DashboardColumns;
}

const STORAGE_KEY = "keasy:dashboard";

function storageKey(jobId: string): string {
  return `${STORAGE_KEY}:${jobId}`;
}

export function loadDashboard(jobId: string): DashboardLayout {
  if (typeof window === "undefined") return { widgets: [], columns: 2 };
  try {
    const raw = localStorage.getItem(storageKey(jobId));
    if (!raw) return { widgets: [], columns: 2 };
    const parsed = JSON.parse(raw);
    // Backward-compatible: old format stored a raw array of widgets
    if (Array.isArray(parsed)) return { widgets: parsed, columns: 2 };
    return {
      widgets: parsed.widgets ?? [],
      columns: parsed.columns ?? 2,
    };
  } catch {
    return { widgets: [], columns: 2 };
  }
}

export function saveDashboard(jobId: string, layout: DashboardLayout): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(storageKey(jobId), JSON.stringify(layout));
}
