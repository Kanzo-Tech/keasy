"use client";

import { useQuery } from "@tanstack/react-query";
import { Boxes, Table2 } from "lucide-react";

import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Item,
  ItemDescription,
  ItemMedia,
  ItemTitle,
  SectionBody,
  SectionDescription,
  SectionHeader,
  SectionRoot,
  SectionTitle,
  SectionTitleGroup,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@kanzo-tech/ui";
import { useDelayedLoading } from "@/hooks/use-delayed-loading";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import type { CatalogDataset } from "@/lib/types";

export default function DatasetsPage() {
  const { data: datasets, isLoading } = useQuery({
    queryKey: queryKeys.catalog.datasets,
    queryFn: api.catalog.datasets,
  });
  const showSkeleton = useDelayedLoading(isLoading);

  return (
    <SectionRoot>
      <SectionHeader scale="page">
        <SectionTitleGroup>
          <SectionTitle level={1} scale="page">
            Data Catalog
          </SectionTitle>
          <SectionDescription>
            Every dataset registered in the workspace catalog — the metadata view of what each
            completed job produced. The data itself stays at its sink; this is the governance
            index over it.
          </SectionDescription>
        </SectionTitleGroup>
      </SectionHeader>
      <SectionBody scale="page">
        {isLoading ? (
          showSkeleton && (
            <>
              <Skeleton className="h-40 w-full" />
              <Skeleton className="h-40 w-full" />
            </>
          )
        ) : !datasets?.length ? (
          <Item className="mx-auto max-w-md flex-col gap-2 py-10 text-center">
            <ItemMedia
              className="group-has-data-[slot=item-description]/item:self-center text-muted-foreground [&_svg:not([class*='size-'])]:size-8"
              variant="icon"
            >
              <Boxes />
            </ItemMedia>
            <ItemTitle className="text-base">No datasets registered yet</ItemTitle>
            <ItemDescription>
              When a job completes, its output is registered here automatically.
            </ItemDescription>
          </Item>
        ) : (
          datasets.map((dataset) => <DatasetCard dataset={dataset} key={dataset.job_id} />)
        )}
      </SectionBody>
    </SectionRoot>
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
