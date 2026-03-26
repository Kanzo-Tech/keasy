"use client";

import { useMemo, useState } from "react";
import { BarChart3, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Selection } from "@uwdata/mosaic-core";
import { FieldHistogram } from "./field-histogram";
import type { GraphSchema } from "@/lib/graph-schema";

interface Props {
  schema: GraphSchema;
  selection: Selection;
}

export function HistogramPanel({ schema, selection }: Props) {
  const [open, setOpen] = useState(false);

  // Collect fields worth showing histograms for (measures + dimensions)
  const histogramFields = useMemo(() => {
    const fields: { tableName: string; fieldName: string; fieldType: string }[] = [];
    for (const t of schema.types) {
      const typeFields = schema.fieldsOf(t.name);
      for (const f of typeFields) {
        if (f.name === "_id" || f.name === "subject") continue;
        if (f.role === "measure" || f.role === "dimension" || f.role === "identifier") {
          fields.push({ tableName: t.name, fieldName: f.name, fieldType: f.type });
        }
      }
    }
    return fields.slice(0, 12);
  }, [schema]);

  if (histogramFields.length === 0) return null;

  return (
    <div className="border-t bg-background">
      <Button
        variant="ghost"
        size="sm"
        className="w-full h-7 rounded-none text-xs gap-1.5 text-muted-foreground hover:text-foreground"
        onClick={() => setOpen((v) => !v)}
      >
        <BarChart3 size={12} />
        Distributions ({histogramFields.length})
        {open ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
      </Button>
      {open && (
        <ScrollArea className="w-full">
          <div className="flex gap-2 px-2 pb-2 min-w-0">
            {histogramFields.map((f) => (
              <div key={`${f.tableName}.${f.fieldName}`} className="w-44 shrink-0">
                <FieldHistogram
                  tableName={f.tableName}
                  fieldName={f.fieldName}
                  fieldType={f.fieldType}
                  selection={selection}
                />
              </div>
            ))}
          </div>
          <ScrollBar orientation="horizontal" />
        </ScrollArea>
      )}
    </div>
  );
}
