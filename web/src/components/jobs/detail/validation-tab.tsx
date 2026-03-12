"use client";

import { useEffect, useState } from "react";
import { Play, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { toastError } from "@/lib/toast-error";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import { PageShell } from "@/components/layout/page-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { FormField } from "@/components/shared/form-layout";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { localName, cleanValidationMessage } from "@/lib/formatters";
import type {
  FileEntry,
  ShapeValidationResult,
} from "@/lib/types";

const SHEX_EXTENSIONS = ["shex", "shexj"];

interface ValidationTabProps {
  jobId: string;
}

export function ValidationTab({ jobId }: ValidationTabProps) {
  const [selectedConnection, setSelectedConnection] = useState("");
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [selectedFile, setSelectedFile] = useState("");
  const [filesLoading, setFilesLoading] = useState(false);
  const [validating, setValidating] = useState(false);
  const [result, setResult] = useState<ShapeValidationResult | null>(null);
  const [view, setView] = useState<"errors" | "valid">("errors");

  const { data: vocabConnections } = useQuery({
    queryKey: queryKeys.vocab.connections,
    queryFn: () => api.connections.list("vocab"),
  });

  useEffect(() => {
    if (!selectedConnection) {
      setFiles([]);
      setSelectedFile("");
      return;
    }
    setFilesLoading(true);
    setSelectedFile("");
    setResult(null);
    api.connections.files(selectedConnection)
      .then((f) => setFiles(f.filter((e) => {
        const ext = e.path.split(".").pop()?.toLowerCase() ?? "";
        return SHEX_EXTENSIONS.includes(ext);
      })))
      .catch(() => {
        toastError("Failed to list files");
        setFiles([]);
      })
      .finally(() => setFilesLoading(false));
  }, [selectedConnection]);

  async function handleValidate() {
    if (!selectedConnection || !selectedFile) return;
    setValidating(true);
    setResult(null);
    try {
      const r = await api.validation.validate(jobId, selectedConnection, selectedFile);
      setResult(r);
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Validation failed");
    } finally {
      setValidating(false);
    }
  }

  const canValidate = !!selectedConnection && !!selectedFile && !validating;

  return (
    <PageShell>
    <PageShell.Content>
      {/* Shape selection */}
      <div className="space-y-3">
        <p className="text-sm font-medium">Select a ShEx shape to validate this job's output</p>
        <p className="text-xs text-muted-foreground">Pick a vocabulary connection and a ShEx file (.shex or .shexj).</p>
        {(vocabConnections ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">No vocabulary connections configured.</p>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            <FormField label="Vocab Connection">
              <Combobox
                options={(vocabConnections ?? []).map((s) => ({ value: s.id, label: s.name }))}
                value={selectedConnection}
                onValueChange={setSelectedConnection}
                placeholder="Select connection..."
                searchPlaceholder="Search connections..."
                emptyMessage="No vocab connections found."
              />
            </FormField>
            <FormField label="Shape file">
              <Combobox
                options={files.map((f) => ({
                  value: f.path,
                  label: f.path,
                  suffix: <Badge variant="outline" className="text-[10px] px-1.5 py-0">ShEx</Badge>,
                }))}
                value={selectedFile}
                onValueChange={setSelectedFile}
                placeholder={filesLoading ? "Loading..." : "Select shape..."}
                searchPlaceholder="Search shapes..."
                emptyMessage="No ShEx files found."
                disabled={!selectedConnection || filesLoading}
                mono
              />
            </FormField>
          </div>
        )}
      </div>

      {/* Results */}
      {result && (
        <div className="flex-1 min-h-0 flex flex-col space-y-3 pt-6">
          <div className="flex items-center justify-between">
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              value={view}
              onValueChange={(v) => { if (v) setView(v as "errors" | "valid"); }}
            >
              <ToggleGroupItem value="errors" className="text-[11px] h-6 px-2">
                Errors
              </ToggleGroupItem>
              <ToggleGroupItem value="valid" className="text-[11px] h-6 px-2">
                Valid
              </ToggleGroupItem>
            </ToggleGroup>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-1.5 text-sm text-green-500">
                <CheckCircle2 size={16} />
                {result.valid_nodes.length} valid
              </div>
              {result.errors.length > 0 && (
                <div className="flex items-center gap-1.5 text-sm text-destructive">
                  <XCircle size={16} />
                  {result.errors.length} {result.errors.length === 1 ? "error" : "errors"}
                </div>
              )}
            </div>
          </div>

          <ScrollArea className="flex-1 min-h-0">
            {view === "errors" && result.errors.length > 0 && (
              <Table>
                <TableHeader className="sticky top-0 bg-background z-10">
                  <TableRow>
                    <TableHead>Node</TableHead>
                    <TableHead>Message</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.errors.map((e, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-mono text-xs" title={e.node}>
                        {localName(e.node)}
                      </TableCell>
                      <TableCell className="text-sm">
                        {cleanValidationMessage(e.message, e.node)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}

            {view === "valid" && result.valid_nodes.length > 0 && (
              <Table>
                <TableHeader className="sticky top-0 bg-background z-10">
                  <TableRow>
                    <TableHead>Node</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.valid_nodes.map((node, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-mono text-xs" title={node}>
                        {localName(node)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </ScrollArea>
        </div>
      )}
    </PageShell.Content>
    <PageShell.Footer>
      <div />
      <Button disabled={!canValidate} onClick={handleValidate}>
        {validating ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
        {validating ? "Validating..." : "Validate"}
      </Button>
    </PageShell.Footer>
    </PageShell>
  );
}
