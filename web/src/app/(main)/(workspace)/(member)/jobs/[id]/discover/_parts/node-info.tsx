"use client";

import { skipToken, useQuery } from "@tanstack/react-query";
import { MousePointerClick } from "lucide-react";
import {
  DataList,
  DataListItem,
  DataListItemLabel,
  DataListItemValue,
  Item,
  ItemDescription,
  ItemMedia,
  ItemTitle,
  ScrollArea,
  Skeleton,
  Swatch,
} from "@kanzo-tech/ui";
import { scaleOf } from "@kanzo-tech/graph";
import type { GraphSchema } from "@/lib/graph-schema";
import { queryKeys } from "@/lib/query-keys";
import { ONCE, useCorpus } from "./corpus";

export interface SelectedVertex {
  id: string;
  type: string;
  label: string;
}

export function NodeInfo({ schema, vertex }: { schema: GraphSchema; vertex: SelectedVertex | null }) {
  const { jobId, corpus } = useCorpus();
  const { data: fields, isPending } = useQuery({
    queryKey: [...queryKeys.corpus(jobId), "node", vertex?.type, vertex?.id],
    queryFn: vertex
      ? async () => (await corpus.node(vertex.id, { type: vertex.type }))?.fields ?? null
      : skipToken,
    ...ONCE,
  });

  if (!vertex) {
    return (
      <Item className="mx-auto my-auto max-w-md flex-col gap-2 py-10 text-center">
        <ItemMedia className="text-muted-foreground" variant="icon">
          <MousePointerClick />
        </ItemMedia>
        <ItemTitle>No node selected</ItemTitle>
        <ItemDescription>Click any node on the graph to view its properties.</ItemDescription>
      </Item>
    );
  }

  const properties = Object.entries(fields ?? {}).filter(([, value]) => value != null && value !== "");
  const typeIndex = schema.types.findIndex((t) => t.name === vertex.type);

  return (
    <ScrollArea className="h-full">
      <div className="space-y-3 p-3">
        <div>
          <p className="flex items-center gap-1.5 truncate text-sm font-medium">
            {typeIndex >= 0 && <Swatch color={scaleOf({}).color(typeIndex)} shape="round" size="xs" />}
            {vertex.label}
          </p>
          <p className="text-muted-foreground text-xs">{vertex.type}</p>
        </div>
        {isPending ? (
          <Skeleton className="h-24 w-full" />
        ) : properties.length === 0 ? (
          <p className="text-muted-foreground text-xs">No properties.</p>
        ) : (
          <DataList orientation="vertical">
            {properties.map(([predicate, value]) => (
              <DataListItem className="gap-0.5 py-0" key={predicate}>
                <DataListItemLabel className="text-xs">{predicate}</DataListItemLabel>
                <DataListItemValue className="break-all font-mono text-xs">{String(value)}</DataListItemValue>
              </DataListItem>
            ))}
          </DataList>
        )}
        <p className="break-all font-mono text-muted-foreground text-xs">{vertex.id}</p>
      </div>
    </ScrollArea>
  );
}
