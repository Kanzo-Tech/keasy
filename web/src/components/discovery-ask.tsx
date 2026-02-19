"use client";

import { useState } from "react";
import { AlertCircle, Send } from "lucide-react";
import { askDiscover } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { AskResponse } from "@/lib/types";

interface DiscoveryAskProps {
  jobId: string;
}

interface QAEntry {
  question: string;
  response: AskResponse;
  error?: boolean;
}

export function DiscoveryAsk({ jobId }: DiscoveryAskProps) {
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<QAEntry[]>([]);

  async function handleAsk() {
    const q = question.trim();
    if (!q) return;
    setLoading(true);
    try {
      const response = await askDiscover(jobId, q);
      setHistory((prev) => [...prev, { question: q, response }]);
      setQuestion("");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Ask failed";
      setHistory((prev) => [...prev, { question: q, response: { answer: msg }, error: true }]);
      setQuestion("");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex-1 overflow-y-auto space-y-4 mb-3">
        {history.length === 0 && (
          <div className="text-center py-12 text-muted-foreground text-sm">
            Ask a question about your data. The AI will generate a SPARQL query and return results.
          </div>
        )}
        {history.map((entry, i) => (
          <div key={i} className="space-y-2">
            <div className="text-sm font-medium">{entry.question}</div>
            {entry.response.answer && (
              entry.error || entry.response.answer.startsWith("Generated query failed") ? (
                <div className="flex items-start gap-2 text-sm text-destructive">
                  <AlertCircle size={14} className="mt-0.5 shrink-0" />
                  <p>{entry.response.answer}</p>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">{entry.response.answer}</p>
              )
            )}
            {entry.response.sparql && (
              <Collapsible>
                <CollapsibleTrigger className="text-xs text-muted-foreground hover:text-foreground">
                  SPARQL query
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <pre className="text-xs bg-muted p-2 rounded-md mt-1 overflow-x-auto font-mono">
                    {entry.response.sparql}
                  </pre>
                </CollapsibleContent>
              </Collapsible>
            )}
            {entry.response.data && entry.response.data.rows.length > 0 && (
              <div className="border rounded-md overflow-auto max-h-60">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {entry.response.data.columns.map((col) => (
                        <TableHead key={col} className="text-xs h-8">
                          {col}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {entry.response.data.rows.map((row, ri) => (
                      <TableRow key={ri}>
                        {entry.response.data!.columns.map((col) => (
                          <TableCell key={col} className="text-xs py-1.5">
                            {String(row[col] ?? "")}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
            {entry.response.data && entry.response.data.rows.length === 0 && (
              <p className="text-xs text-muted-foreground">No results.</p>
            )}
          </div>
        ))}
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          handleAsk();
        }}
      >
        <Input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Ask about your data..."
          disabled={loading}
          className="flex-1"
        />
        <Button type="submit" size="sm" disabled={loading || !question.trim()}>
          <Send size={14} />
        </Button>
      </form>
    </div>
  );
}
