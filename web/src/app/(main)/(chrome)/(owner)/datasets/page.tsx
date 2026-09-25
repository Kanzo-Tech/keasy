"use client";

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
import { $api, type Schemas } from "@/lib/api/client";

export default function DatasetsPage() {
  const { data: datasets, isLoading } = $api.useQuery("get", "/v1/datasets");
  const showSkeleton = useDelayedLoading(isLoading);

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
        {isLoading ? (
          showSkeleton && (
            <>
              <Skeleton className="h-40 w-full" />
              <Skeleton className="h-40 w-full" />
            </>
          )
        ) : !datasets?.length ? (
          <Item className="mx-auto my-auto max-w-md flex-col gap-2 py-10 text-center">
            <ItemMedia
              className="group-has-data-[slot=item-description]/item:self-center text-muted-foreground [&_svg:not([class*='size-'])]:size-8"
              variant="icon"
            >
              <Boxes />
            </ItemMedia>
            <ItemTitle className="text-base">No datasets yet</ItemTitle>
            <ItemDescription>
              When a job completes, its output is listed here automatically.
            </ItemDescription>
          </Item>
        ) : (
          datasets.map((dataset) => <DatasetCard dataset={dataset} key={dataset.job_id} />)
        )}
      </SectionBody>
    </SectionRoot>
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
