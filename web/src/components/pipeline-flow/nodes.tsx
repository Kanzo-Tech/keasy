"use client";

import { useState } from "react";
import {
  Position,
  type Node,
  type NodeTypes,
  type NodeProps,
} from "@xyflow/react";
import { Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { BaseNode, BaseNodeHeader } from "@/components/pipeline-flow/base-node";
import { BaseHandle } from "@/components/pipeline-flow/base-handle";
import type { FieldNodeData } from "./types";

function FieldNode({ data }: NodeProps<Node<FieldNodeData>>) {
  const [expanded, setExpanded] = useState(false);
  const pos = data.handleSide === "right" ? Position.Right : Position.Left;
  const handleType = data.handleSide === "right" ? "source" : "target";
  const isOutput = data.handleSide === "left";
  const dualKeys = new Set(data.dualHandleKeys ?? []);
  const dualPos = pos === Position.Right ? Position.Left : Position.Right;
  const dualType = handleType === "source" ? "target" : "source";

  const keyPairs = data.keyPairs ?? [];
  const pairedFieldNames = new Set(
    keyPairs.flatMap((p) => [p.left, p.right]),
  );

  const fieldMap = new Map(data.fields.map((f) => [f.name, f]));

  const regularFields = data.fields.filter(
    (f) => !pairedFieldNames.has(f.name),
  );

  const { usedFields } = data;
  const collapsible =
    usedFields &&
    usedFields.size > 0 &&
    regularFields.some((f) => !usedFields.has(f.name));
  const visibleRegular =
    expanded || !collapsible
      ? regularFields
      : regularFields.filter((f) => usedFields.has(f.name));
  const hiddenCount =
    collapsible && !expanded
      ? regularFields.length - visibleRegular.length
      : 0;

  const hasPairs = keyPairs.length > 0;
  const hasRegular = visibleRegular.length > 0 || hiddenCount > 0;

  return (
    <BaseNode className="min-w-[200px]">
      <BaseNodeHeader className="rounded-tl-md rounded-tr-md bg-secondary p-2 text-center text-sm text-muted-foreground">
        {data.variant === "operation" ? (
          <Badge
            variant="outline"
            className="text-[10px] w-fit border-primary/50"
          >
            {data.label}
          </Badge>
        ) : (
          <h2>{data.label}</h2>
        )}
      </BaseNodeHeader>
      <Separator />
      <div className="flex flex-col overflow-visible">
        {hasPairs && (
          <div className="flex flex-col bg-muted/50">
            {keyPairs.map((pair) => (
              <div
                key={`${pair.left}-${pair.right}`}
                className="relative flex items-center justify-between gap-2 px-3 py-1.5 text-xs"
              >
                <BaseHandle
                  type="target"
                  position={Position.Left}
                  id={`field-${pair.left}`}
                />
                <BaseHandle
                  type="source"
                  position={Position.Right}
                  id={`field-${pair.left}`}
                />
                <span className="font-mono truncate min-w-0">
                  {pair.left}
                  <span className="text-muted-foreground mx-1">=</span>
                  {pair.right}
                </span>
                <span className="text-muted-foreground font-mono shrink-0">
                  {fieldMap.get(pair.left)?.type}
                </span>
              </div>
            ))}
          </div>
        )}
        {hasPairs && hasRegular && <Separator />}
        <div className="flex flex-col divide-y">
          {visibleRegular.map((field) => (
            <div
              key={field.name}
              className="relative flex items-center justify-between gap-2 px-3 py-1.5 text-xs"
            >
              <BaseHandle
                type={handleType}
                position={pos}
                id={`field-${field.name}`}
              />
              {dualKeys.has(field.name) && (
                <BaseHandle
                  type={dualType}
                  position={dualPos}
                  id={`field-${field.name}`}
                />
              )}
              <span className="font-mono truncate min-w-0">{field.name}</span>
              <span className="text-muted-foreground font-mono shrink-0">
                {field.type}
              </span>
            </div>
          ))}
          {hiddenCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setExpanded(true)}
              className="h-auto rounded-none last:rounded-b-md px-3 py-1.5 text-xs text-muted-foreground justify-start"
            >
              + {hiddenCount} more fields
            </Button>
          )}
          {expanded && collapsible && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setExpanded(false)}
              className="h-auto rounded-none last:rounded-b-md px-3 py-1.5 text-xs text-muted-foreground justify-start"
            >
              Show less
            </Button>
          )}
        </div>
      </div>
      {isOutput && (
        <BaseHandle type="source" position={Position.Right} id="dest" />
      )}
    </BaseNode>
  );
}

function DestinationNode({ data }: NodeProps<Node<{ url: string }>>) {
  return (
    <BaseNode>
      <BaseHandle type="target" position={Position.Left} id="target" />
      <div className="flex items-center gap-2 px-3 py-2">
        <Upload size={14} className="text-muted-foreground shrink-0" />
        <span className="text-xs font-mono text-muted-foreground truncate max-w-[200px]">
          {data.url}
        </span>
      </div>
    </BaseNode>
  );
}

export const nodeTypes: NodeTypes = {
  field: FieldNode,
  destination: DestinationNode,
};
