"use client";

import { useQuery } from "@tanstack/react-query";
import { Boxes, Table2 } from "lucide-react";

import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import type { CatalogDataset } from "@/lib/types";
import { PageShell } from "@/components/layout/page-shell";
import { SettingsSection } from "@/components/settings/settings-section";
import { EmptyState } from "@/components/shared/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useDelayedLoading } from "@/hooks/use-delayed-loading";

export default function DatasetsPage() {
  const { data: datasets, isLoading } = useQuery({
    queryKey: queryKeys.catalog.datasets,
    queryFn: api.catalog.datasets,
  });
  const showSkeleton = useDelayedLoading(isLoading);

  return (
    <PageShell>
      <PageShell.Content className="gap-8">
        <SettingsSection
          title="Data Catalog"
          description="Every dataset registered in the workspace catalog — the metadata view of what each completed job produced. The data itself stays at its sink; this is the governance index over it."
        >
          {showSkeleton ? (
            <div className="space-y-4">
              <Skeleton className="h-40 w-full" />
              <Skeleton className="h-40 w-full" />
            </div>
          ) : !datasets?.length ? (
            <EmptyState
              icon={Boxes}
              title="No datasets registered yet"
              description="When a job completes, its output is registered here automatically."
            />
          ) : (
            <div className="space-y-4">
              {datasets.map((dataset) => (
                <DatasetCard key={dataset.job_id} dataset={dataset} />
              ))}
            </div>
          )}
        </SettingsSection>
      </PageShell.Content>
    </PageShell>
  );
}

function DatasetCard({ dataset }: { dataset: CatalogDataset }) {
  const totalRows = dataset.tables.reduce((sum, t) => sum + (t.rows ?? 0), 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 font-mono text-sm">
          <Boxes size={15} className="text-muted-foreground" />
          {dataset.job_id}
        </CardTitle>
        <span className="text-xs text-muted-foreground">
          {dataset.tables.length} {dataset.tables.length === 1 ? "type" : "types"} ·{" "}
          {totalRows.toLocaleString()} rows
        </span>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Type</TableHead>
              <TableHead className="w-24 text-right">Rows</TableHead>
              <TableHead>Columns</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {dataset.tables.map((table) => (
              <TableRow key={table.name}>
                <TableCell className="font-medium">
                  <span className="flex items-center gap-2">
                    <Table2 size={14} className="text-muted-foreground" />
                    {table.name}
                  </span>
                </TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  {table.rows?.toLocaleString() ?? "—"}
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {table.columns.map((col) => (
                      <Badge key={col.name} variant="secondary" className="font-normal">
                        {col.name}
                        <span className="ml-1 text-muted-foreground">{col.data_type.toLowerCase()}</span>
                      </Badge>
                    ))}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
