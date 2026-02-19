"use client";

import { useEffect, useState } from "react";
import { Play, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { toastError } from "@/lib/toast-error";
import { useAsync } from "@/hooks/use-async";
import {
  fetchConnections,
  fetchConnectionFiles,
  validateJob,
} from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { isShapeFile, detectShapeFormat, localName, cleanValidationMessage } from "@/lib/formatters";
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
  const [selectedConn, setSelectedConn] = useState("");
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [selectedFile, setSelectedFile] = useState("");
  const [filesLoading, setFilesLoading] = useState(false);
  const [validating, setValidating] = useState(false);
  const [result, setResult] = useState<ShapeValidationResult | null>(null);

  const { data: connections } = useAsync(() => fetchConnections(), []);

  useEffect(() => {
    if (!selectedConn) {
      setFiles([]);
      setSelectedFile("");
      return;
    }
    setFilesLoading(true);
    setSelectedFile("");
    setResult(null);
    fetchConnectionFiles(selectedConn)
      .then((f) => setFiles(f.filter((e) => isShapeFile(e.path))))
      .catch(() => {
        toast.error("Failed to list files");
        setFiles([]);
      })
      .finally(() => setFilesLoading(false));
  }, [selectedConn]);

  async function handleValidate() {
    if (!selectedDest || !selectedConn || !selectedFile) return;
    setValidating(true);
    setResult(null);
    try {
      const r = await validateJob(selectedDest, selectedConn, selectedFile);
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
    !!selectedDest && !!selectedConn && !!selectedFile && !validating;

  return (
    <div className="space-y-4">
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

      {/* Step 2 — Shape */}
      <div className="flex gap-4">
        <div className="flex flex-col items-center">
          <Badge variant="secondary" className="size-6 p-0 justify-center text-xs shrink-0">2</Badge>
        </div>
        <div className="flex-1 pb-6 space-y-3">
          <p className="text-sm font-medium leading-6">Select the shape</p>
          <p className="text-xs text-muted-foreground">Pick a connection and a ShEx/SHACL file to validate the output.</p>
          {(connections ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No connections configured.</p>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Connection</Label>
                <Combobox
                  options={(connections ?? []).map((c) => ({ value: c.id, label: c.name }))}
                  value={selectedConn}
                  onValueChange={setSelectedConn}
                  placeholder="Select connection..."
                  searchPlaceholder="Search connections..."
                  emptyMessage="No connections found."
                />
              </div>
              <div className="space-y-2">
                <Label>Shape file</Label>
                <Combobox
                  options={files.map((f) => {
                    const fmt = detectShapeFormat(f.path);
                    return {
                      value: f.path,
                      label: f.path,
                      suffix: fmt ? <Badge variant="outline" className="text-[10px] px-1.5 py-0">{fmt}</Badge> : undefined,
                    };
                  })}
                  value={selectedFile}
                  onValueChange={setSelectedFile}
                  placeholder={filesLoading ? "Loading..." : "Select shape..."}
                  searchPlaceholder="Search shapes..."
                  emptyMessage="No shape files found."
                  disabled={!selectedConn || filesLoading}
                  mono
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Validate */}
      <div className="flex justify-end">
        <Button disabled={!canValidate} onClick={handleValidate}>
          {validating ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
          {validating ? "Validating..." : "Validate"}
        </Button>
      </div>

      {/* Results */}
      {result && (
        <div className="space-y-3 pt-6">
          <div className="flex items-center gap-4">
            {result.valid ? (
              <div className="flex items-center gap-1.5 text-sm text-green-500">
                <CheckCircle2 size={16} />
                Valid
              </div>
            ) : (
              <div className="flex items-center gap-1.5 text-sm text-destructive">
                <XCircle size={16} />
                Invalid
              </div>
            )}
            {result.conformant > 0 && (
              <span className="text-xs text-muted-foreground">
                {result.conformant} conformant
              </span>
            )}
            {result.non_conformant > 0 && (
              <span className="text-xs text-destructive">
                {result.non_conformant} non-conformant
              </span>
            )}
          </div>

          {result.errors.length > 0 && (
            <Table>
              <TableHeader>
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
        </div>
      )}
    </div>
  );
}
