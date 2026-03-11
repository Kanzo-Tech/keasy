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

interface ValidationTabProps {
  destinations: string[];
}

export function ValidationTab({ destinations }: ValidationTabProps) {
  const [selectedDest, setSelectedDest] = useState(
    destinations.length === 1 ? destinations[0] : "",
  );
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
  const { data: providers } = useQuery({
    queryKey: queryKeys.settings.providers,
    queryFn: api.settings.providers,
  });

  const schemaProviders = (providers ?? []).filter(
    (p) => p.kind === "schema" || p.kind === "both",
  );
  const schemaExtensions = schemaProviders.flatMap((p) => p.extensions);

  /** Match a file extension to the provider name for badge display. */
  function matchProviderName(path: string): string | null {
    const ext = path.split(".").pop()?.toLowerCase() ?? "";
    const match = schemaProviders.find((p) => p.extensions.includes(ext));
    return match?.name ?? null;
  }

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
        return schemaExtensions.includes(ext);
      })))
      .catch(() => {
        toastError("Failed to list files");
        setFiles([]);
      })
      .finally(() => setFilesLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps -- re-filter when providers load
  }, [selectedConnection, providers]);

  async function handleValidate() {
    if (!selectedDest || !selectedConnection || !selectedFile) return;
    setValidating(true);
    setResult(null);
    try {
      const r = await api.validation.validate(selectedDest, selectedConnection, selectedFile);
      setResult(r);
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Validation failed");
    } finally {
      setValidating(false);
    }
  }

  if (destinations.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-4">
        This job has no cloud output destinations to validate.
      </p>
    );
  }

  const canValidate =
    !!selectedDest && !!selectedConnection && !!selectedFile && !validating;

  return (
    <PageShell>
    <PageShell.Content>
      {/* Step 1 — Output data */}
      <div className="flex gap-4">
        <div className="flex flex-col items-center">
          <Badge variant="secondary" className="size-6 p-0 justify-center text-xs shrink-0">1</Badge>
          <div className="flex-1 w-px bg-border mt-2" />
        </div>
        <div className="flex-1 pb-6 space-y-3">
          <p className="text-sm font-medium leading-6">Select the output data</p>
          <p className="text-xs text-muted-foreground">Choose which output destination to validate against a shape.</p>
          <Combobox
            options={destinations.map((d) => ({ value: d, label: d }))}
            value={selectedDest}
            onValueChange={setSelectedDest}
            placeholder="Select destination..."
            searchPlaceholder="Search destinations..."
            emptyMessage="No destinations found."
            mono
          />
        </div>
      </div>

      {/* Step 2 — Shape from vocab source */}
      <div className="flex gap-4">
        <div className="flex flex-col items-center">
          <Badge variant="secondary" className="size-6 p-0 justify-center text-xs shrink-0">2</Badge>
        </div>
        <div className="flex-1 pb-6 space-y-3">
          <p className="text-sm font-medium leading-6">Select the shape</p>
          <p className="text-xs text-muted-foreground">Pick a vocabulary connection and a ShEx/SHACL file to validate the output.</p>
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
                  options={files.map((f) => {
                    const name = matchProviderName(f.path);
                    return {
                      value: f.path,
                      label: f.path,
                      suffix: name ? <Badge variant="outline" className="text-[10px] px-1.5 py-0">{name}</Badge> : undefined,
                    };
                  })}
                  value={selectedFile}
                  onValueChange={setSelectedFile}
                  placeholder={filesLoading ? "Loading..." : "Select shape..."}
                  searchPlaceholder="Search shapes..."
                  emptyMessage="No shape files found."
                  disabled={!selectedConnection || filesLoading}
                  mono
                />
              </FormField>
            </div>
          )}
        </div>
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
