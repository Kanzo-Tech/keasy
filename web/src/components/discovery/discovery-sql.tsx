"use client";

import { useState } from "react";
import { Loader2, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { PanelHeader } from "@/components/layout/workspace-layout";
import { api, type ExecuteSqlResult } from "@/lib/api";

/**
 * Owner-only raw SQL panel. The request is gated server-side
 * (`Require<IsOwner>`) and executed natively via fossil-mcp's `execute_sql`
 * verb — this panel is only mounted for owners (see the discover page).
 */
export function DiscoverySql({ jobId }: { jobId: string }) {
  const [sql, setSql] = useState("");
  const [result, setResult] = useState<ExecuteSqlResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const run = async () => {
    if (!sql.trim() || running) return;
    setRunning(true);
    setError(null);
    try {
      setResult(await api.discovery.executeSql(jobId, sql));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setResult(null);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <PanelHeader title="SQL" />

      <div className="shrink-0 border-b p-2 space-y-2">
        <textarea
          value={sql}
          onChange={(e) => setSql(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) run();
          }}
          placeholder="SELECT * FROM &quot;Person&quot; LIMIT 10"
          spellCheck={false}
          className="w-full h-24 resize-none rounded-sm border bg-transparent p-2 font-mono text-[11px] outline-none focus:ring-1 focus:ring-ring"
        />
        <Button size="sm" className="w-full h-7" onClick={run} disabled={running || !sql.trim()}>
          {running ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play size={12} />}
          <span className="ml-1.5 text-xs">Run (⌘↵)</span>
        </Button>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-2 text-xs">
          {error && <p className="text-destructive font-mono break-all">{error}</p>}
          {result && !error && (
            <>
              {result.truncated && (
                <p className="text-[10px] text-muted-foreground mb-1">Result truncated.</p>
              )}
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr>
                      {result.columns.map((c) => (
                        <th key={c.name} className="text-left px-1.5 py-1 border-b font-medium whitespace-nowrap">
                          {c.name}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.rows.map((row, i) => (
                      <tr key={i} className="even:bg-muted/30">
                        {result.columns.map((c) => (
                          <td key={c.name} className="px-1.5 py-1 font-mono text-[11px] whitespace-nowrap">
                            {row[c.name] == null ? "" : String(row[c.name])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {result.rows.length === 0 && <p className="text-muted-foreground py-2">No rows.</p>}
            </>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
