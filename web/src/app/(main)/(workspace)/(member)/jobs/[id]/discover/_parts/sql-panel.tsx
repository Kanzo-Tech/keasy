"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Play } from "lucide-react";
import { Alert, AlertDescription, Button, Kbd, ScrollArea, Spinner, Textarea } from "@kanzo-tech/ui";
import { useCorpus } from "./corpus";
import { ResultTable } from "./result-table";

/**
 * Raw SQL over the producer's own dataset, run in the browser by `corpus.executeSql`
 * (DuckDB-WASM over the signed-URL Parquet). Sovereignty is enforced where the URLs are signed:
 * only the producer gets them for their job.
 */
export function SqlPanel() {
  const { corpus } = useCorpus();
  const [sql, setSql] = useState("");
  const run = useMutation({ mutationFn: (statement: string) => corpus.executeSql({ sql: statement }) });
  const submit = () => {
    if (sql.trim() && !run.isPending) run.mutate(sql);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 space-y-2 border-b p-2">
        <Textarea
          className="h-24 resize-none font-mono text-xs"
          onChange={(e) => setSql(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
          }}
          placeholder='SELECT * FROM "Person" LIMIT 10'
          spellCheck={false}
          value={sql}
        />
        <Button className="w-full" disabled={run.isPending || !sql.trim()} onClick={submit} size="sm">
          {run.isPending ? <Spinner /> : <Play />}
          Run <Kbd>⌘↵</Kbd>
        </Button>
      </div>
      <ScrollArea className="flex-1">
        <div className="space-y-2 p-2">
          {run.error && (
            <Alert variant="destructive">
              <AlertDescription className="break-all font-mono text-xs">{run.error.message}</AlertDescription>
            </Alert>
          )}
          {run.data && <ResultTable pageSize={20} result={run.data} />}
        </div>
      </ScrollArea>
    </div>
  );
}
