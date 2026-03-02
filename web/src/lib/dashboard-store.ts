import { api } from "./api";

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

const DEFAULT_LAYOUT: DashboardLayout = { widgets: [], columns: 2 };

export async function loadDashboard(jobId: string): Promise<DashboardLayout> {
  try {
    const data = await api.jobs.dashboardLayout(jobId);
    if (!data) return DEFAULT_LAYOUT;
    return {
      widgets: (data.widgets as ChartWidget[]) ?? [],
      columns: (data.columns as DashboardColumns) ?? 2,
    };
  } catch {
    return DEFAULT_LAYOUT;
  }
}

export async function saveDashboard(
  jobId: string,
  layout: DashboardLayout,
): Promise<void> {
  try {
    await api.jobs.saveDashboardLayout(jobId, layout);
  } catch {
  }
}
