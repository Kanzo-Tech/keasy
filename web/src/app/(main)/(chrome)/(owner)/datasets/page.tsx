"use client";

import { Boxes, Table2 } from "lucide-react";

import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyDescription,
  EmptyHeader,
  EmptyIndicator,
  EmptyRoot,
  EmptyTitle,
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
import { Boundary, Loading } from "@/components/boundary";
import { settled } from "@/lib/api/settled";
import { $api, type Schemas } from "@/lib/api/client";

export default function DatasetsPage() {
  return (
    <SectionRoot>
      <SectionHeader scale="page">
        <SectionTitleGroup>
          <SectionTitle level={1} scale="page">
            Data Catalog
          </SectionTitle>
          <SectionDescription>
            Every dataset the workspace produced — the metadata view of what each completed job
            wrote. The data itself stays at its sink.
          </SectionDescription>
        </SectionTitleGroup>
      </SectionHeader>
      <SectionBody scale="page">
        <Boundary
          fallback={
            <Loading>
              <Skeleton className="h-40 w-full" />
              <Skeleton className="h-40 w-full" />
            </Loading>
          }
        >
          <Datasets />
        </Boundary>
      </SectionBody>
    </SectionRoot>
  );
}

function Datasets() {
  const datasets = settled($api.useSuspenseQuery("get", "/v1/datasets"));
  return datasets.length === 0 ? (
    <EmptyRoot>
      <EmptyHeader>
        <EmptyIndicator variant="icon">
          <Boxes />
        </EmptyIndicator>
        <EmptyTitle asChild>
          <h2>No datasets yet</h2>
        </EmptyTitle>
        <EmptyDescription>
          When a job completes, its output is listed here automatically.
        </EmptyDescription>
      </EmptyHeader>
    </EmptyRoot>
  ) : (
    datasets.map((dataset) => <DatasetCard dataset={dataset} key={dataset.job_id} />)
  );
}

function DatasetCard({ dataset }: { dataset: Schemas["Dataset"] }) {
  const totalRows = dataset.relations.reduce((sum, r) => sum + (r.rows ?? 0), 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 font-mono text-sm">
          <Boxes size={15} className="text-muted-foreground" />
          {dataset.name ?? dataset.job_id}
        </CardTitle>
        <span className="text-xs text-muted-foreground">
          {dataset.relations.length} {dataset.relations.length === 1 ? "type" : "types"} ·{" "}
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
            {dataset.relations.map((relation) => (
              <TableRow key={relation.name}>
                <TableCell className="font-medium">
                  <span className="flex items-center gap-2">
                    <Table2 size={14} className="text-muted-foreground" />
                    {relation.name}
                  </span>
                </TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  {relation.rows?.toLocaleString() ?? "—"}
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {relation.columns?.map((col) => (
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
