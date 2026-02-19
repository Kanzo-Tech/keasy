import { ArrowRight } from "lucide-react";
import type { SourceInfo, OutputInfo, FieldMapping } from "@/lib/types";

interface PipelineSummaryProps {
  sources: SourceInfo[];
  outputs: OutputInfo[];
  /** Hide destination lines (when shown elsewhere, e.g. the summary header). */
  hideDestination?: boolean;
}

export function PipelineSummary({ sources, outputs, hideDestination }: PipelineSummaryProps) {
  // Group outputs by their source field
  const outputsBySource = new Map<string, OutputInfo[]>();
  const orphanOutputs: OutputInfo[] = [];

  for (const out of outputs) {
    if (out.source) {
      const existing = outputsBySource.get(out.source) ?? [];
      existing.push(out);
      outputsBySource.set(out.source, existing);
    } else {
      orphanOutputs.push(out);
    }
  }

  // Lookup source info by name
  const sourceByName = new Map(sources.map((s) => [s.name, s]));

  // Sources that don't appear in any output's source
  const linkedSources = new Set(outputsBySource.keys());
  const standaloneSources = sources.filter((s) => !linkedSources.has(s.name));

  return (
    <div className="space-y-3">
      {Array.from(outputsBySource.entries()).map(([sourceName, outs]) => (
        <SourceGroup
          key={sourceName}
          sourceName={sourceName}
          sourceInfo={sourceByName.get(sourceName)}
          outputs={outs}
          hideDestination={hideDestination}
        />
      ))}

      {orphanOutputs.length > 0 && (
        <SourceGroup outputs={orphanOutputs} hideDestination={hideDestination} />
      )}

      {standaloneSources.map((src) => (
        <div
          key={src.name}
          className="rounded-lg border border-border/70 px-3 py-2.5"
        >
          <span className="font-mono text-sm font-medium">{src.name}</span>
          {src.fields.length > 0 && (
            <p className="text-xs text-muted-foreground font-mono mt-1">
              {src.fields.join(", ")}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * Build effective mappings for an output.
 * - If the server sent mappings, use them (they have the real source expressions).
 * - Otherwise, infer: record fields by name match, ctor params as "?" (unknown source).
 */
function effectiveMappings(out: OutputInfo, sourceFields: string[]): FieldMapping[] {
  if (out.mappings && out.mappings.length > 0) return out.mappings;

  const sourceSet = new Set(sourceFields);
  const mappings: FieldMapping[] = [];

  // Ctor params: we can't infer which source field feeds them — show as "?"
  for (const p of out.ctor_params) {
    mappings.push({ source: "?", target: p });
  }

  // Record fields: match by name (field shorthand)
  for (const f of out.fields) {
    if (sourceSet.has(f)) {
      mappings.push({ source: f, target: f });
    } else {
      mappings.push({ source: "\u2014", target: f });
    }
  }

  return mappings;
}

function SourceGroup({
  sourceName,
  sourceInfo,
  outputs,
  hideDestination,
}: {
  sourceName?: string;
  sourceInfo?: SourceInfo;
  outputs: OutputInfo[];
  hideDestination?: boolean;
}) {
  const sourceFields = sourceInfo?.fields ?? [];

  return (
    <div className="rounded-lg border border-border/70 overflow-hidden">
      {/* Source header */}
      {sourceName && (
        <div className="px-3 py-2 bg-muted/40 border-b border-border/50">
          <span className="font-mono text-sm font-medium">{sourceName}</span>
          {sourceFields.length > 0 && (
            <p className="text-xs text-muted-foreground font-mono mt-1">
              {sourceFields.join(", ")}
            </p>
          )}
        </div>
      )}

      {/* Output rows */}
      <div className="divide-y divide-border/40">
        {outputs.map((out, i) => {
          const mappings = effectiveMappings(out, sourceFields);

          return (
            <div key={i} className="px-3 py-2.5">
              {/* Type name with ctor params */}
              <div className="flex items-center gap-2">
                <ArrowRight
                  size={14}
                  className="text-muted-foreground shrink-0"
                />
                <span className="font-mono text-sm font-medium text-primary">
                  {out.type_name}
                  {out.ctor_params.length > 0 && (
                    <span className="text-muted-foreground font-normal">
                      ({out.ctor_params.join(", ")})
                    </span>
                  )}
                </span>
              </div>

              {/* Field mappings, indented under the arrow */}
              {mappings.length > 0 && (
                <div className="ml-[22px] mt-1.5 space-y-0.5">
                  {mappings.map((m) => (
                    <div key={m.target} className="flex items-center gap-1.5 text-xs font-mono">
                      <span className="text-muted-foreground">{m.source}</span>
                      <ArrowRight size={10} className="text-muted-foreground/50 shrink-0" />
                      <span className="font-medium text-foreground">{m.target}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Destination (only when not hidden) */}
              {!hideDestination && out.destination && (
                <div className="ml-[22px] mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                  <ArrowRight size={10} />
                  <span className="font-mono">{out.destination}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
