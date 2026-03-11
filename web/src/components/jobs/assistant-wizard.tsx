"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  type ColumnDef,
  type RowSelectionState,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { toast } from "sonner";
import { toastError } from "@/lib/toast-error";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { CodeEditor } from "@/components/discovery/code-editor";
import { PageShell } from "@/components/layout/page-shell";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { selectColumn } from "@/components/ui/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Database, Loader2, MoreHorizontal, Plus, Wand2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type {
  Connection,
  ColumnInfo,
  CompetencyQuestion,
  FileSchema,
  ProviderInfo,
} from "@/lib/types";
import { cn } from "@/lib/utils";
import { formatSize } from "@/lib/formatters";
import { StepIndicator } from "@/components/shared/step-indicator";

interface AssistantWizardProps {
  onComplete: (script: string, shex: string) => void;
  connections: Connection[];
  providers: ProviderInfo[];
}

const STEPS = ["Connections", "Describe", "Requirements", "Generate"] as const;

// ── Expanded row: file picker per connection ────────────────────────────

function ConnectionFilesRow({
  connectionId,
  providers,
  selectedFiles,
  onToggleFile,
  onToggleAll,
  onSupportedCount,
}: {
  connectionId: string;
  providers: ProviderInfo[];
  selectedFiles: Set<string>;
  onToggleFile: (path: string) => void;
  onToggleAll: (paths: string[]) => void;
  onSupportedCount: (count: number) => void;
}) {
  const { data: files, isLoading } = useQuery({
    queryKey: queryKeys.connections.files(connectionId),
    queryFn: () => api.connections.files(connectionId),
  });

  const supportedExts = useMemo(
    () =>
      providers
        .filter((p) => p.kind === "data" || p.kind === "both")
        .flatMap((p) => p.extensions),
    [providers],
  );

  const supported = useMemo(() => {
    if (!files) return [];
    return supportedExts.length > 0
      ? files.filter((f) =>
          supportedExts.includes(f.path.split(".").pop()?.toLowerCase() ?? ""),
        )
      : files;
  }, [files, supportedExts]);

  // Auto-select all supported files on first load & report count
  const autoSelectedRef = useMemo(() => ({ done: false }), [connectionId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (supported.length > 0 && !autoSelectedRef.done) {
      autoSelectedRef.done = true;
      onToggleAll(supported.map((f) => f.path));
    }
    onSupportedCount(supported.length);
  }, [supported, autoSelectedRef, onToggleAll, onSupportedCount]);

  if (isLoading) {
    return (
      <TableRow className="bg-muted/30 hover:bg-muted/30">
        <TableCell />
        <TableCell className="py-1.5">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            Loading files...
          </div>
        </TableCell>
        <TableCell />
      </TableRow>
    );
  }

  if (supported.length === 0) {
    return (
      <TableRow className="bg-muted/30 hover:bg-muted/30">
        <TableCell />
        <TableCell className="py-1.5">
          <p className="text-xs text-muted-foreground">No supported files found.</p>
        </TableCell>
        <TableCell />
      </TableRow>
    );
  }

  return (
    <>
      {supported.map((f, i) => (
        <TableRow key={f.path} className="bg-muted/30 hover:bg-muted/40">
          <TableCell className={cn("pl-6", i === 0 && "pt-2", i === supported.length - 1 && "pb-2")}>
            <Checkbox
              checked={selectedFiles.has(f.path)}
              onCheckedChange={() => onToggleFile(f.path)}
              aria-label={f.path}
            />
          </TableCell>
          <TableCell className={cn("py-1", i === 0 && "pt-2", i === supported.length - 1 && "pb-2")}>
            <span className="font-mono text-xs">{f.path}</span>
          </TableCell>
          <TableCell className={cn("py-1 text-right", i === 0 && "pt-2", i === supported.length - 1 && "pb-2")}>
            <span className="text-xs text-muted-foreground">{formatSize(f.size)}</span>
          </TableCell>
        </TableRow>
      ))}
    </>
  );
}

// ── Step 1: Connections ─────────────────────────────────────────────────

function StepConnections({
  connections,
  rowSelection,
  onRowSelectionChange,
  providers,
  fileSelection,
  fileCounts,
  onToggleFile,
  onToggleAll,
  onSupportedCount,
}: {
  connections: Connection[];
  rowSelection: RowSelectionState;
  onRowSelectionChange: (s: RowSelectionState) => void;
  providers: ProviderInfo[];
  fileSelection: Map<string, Set<string>>;
  fileCounts: Map<string, number>;
  onToggleFile: (connId: string, path: string) => void;
  onToggleAll: (connId: string, paths: string[]) => void;
  onSupportedCount: (connId: string, count: number) => void;
}) {
  const columns: ColumnDef<Connection>[] = useMemo(() => [
    {
      id: "select",
      header: ({ table }) => (
        <Checkbox
          checked={
            table.getIsAllPageRowsSelected() ||
            (table.getIsSomePageRowsSelected() && "indeterminate")
          }
          onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
          aria-label="Select all"
          onClick={(e) => e.stopPropagation()}
        />
      ),
      cell: ({ row }) => {
        const connId = row.id;
        const selected = fileSelection.get(connId)?.size ?? 0;
        const total = fileCounts.get(connId) ?? 0;
        const isSelected = row.getIsSelected();
        const allFilesSelected = !isSelected || total === 0 || selected >= total;

        return (
          <Checkbox
            checked={isSelected && allFilesSelected ? true : isSelected ? "indeterminate" : false}
            onCheckedChange={(value) => row.toggleSelected(!!value)}
            aria-label="Select row"
            onClick={(e) => e.stopPropagation()}
          />
        );
      },
      enableSorting: false,
      enableHiding: false,
      size: 40,
    },
    {
      accessorKey: "name",
      header: "Name",
      cell: ({ getValue }) => <span className="font-medium">{getValue<string>()}</span>,
    },
    {
      accessorKey: "url",
      header: "URL",
      cell: ({ getValue }) => (
        <span className="text-muted-foreground font-mono text-xs">{getValue<string>()}</span>
      ),
    },
  ], [fileSelection, fileCounts]);

  const table = useReactTable({
    data: connections,
    columns,
    getCoreRowModel: getCoreRowModel(),
    onRowSelectionChange: (updater) => {
      const next = typeof updater === "function" ? updater(rowSelection) : updater;
      onRowSelectionChange(next);
    },
    getRowId: (row) => row.id,
    state: { rowSelection },
  });

  if (connections.length === 0) {
    return (
      <EmptyState
        icon={Database}
        title="No data connections"
        description={
          <>
            <Link href="/connections/new?type=data" className="underline underline-offset-4 hover:text-foreground">
              Create a data connection
            </Link>{" "}
            first to use the assistant.
          </>
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-muted-foreground">
        Select the data connections to include.
      </p>
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((hg) => (
            <TableRow key={hg.id}>
              {hg.headers.map((h) => (
                <TableHead key={h.id}>
                  {h.isPlaceholder ? null : flexRender(h.column.columnDef.header, h.getContext())}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.map((row) => (
            <Fragment key={row.id}>
              <TableRow
                className="cursor-pointer"
                onClick={() => row.toggleSelected()}
              >
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
              {row.getIsSelected() && row.original.location_type === "cloud" && (
                <ConnectionFilesRow
                  key={`${row.id}-files`}
                  connectionId={row.id}
                  providers={providers}
                  selectedFiles={fileSelection.get(row.id) ?? new Set()}
                  onToggleFile={(path) => onToggleFile(row.id, path)}
                  onToggleAll={(paths) => onToggleAll(row.id, paths)}
                  onSupportedCount={(count) => onSupportedCount(row.id, count)}
                />
              )}
            </Fragment>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

// ── Step 2: Describe ────────────────────────────────────────────────────

function StepDescribe({
  domain,
  onDomainChange,
}: {
  domain: string;
  onDomainChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-col flex-1 min-h-0 gap-2">
      <p className="text-sm text-muted-foreground">
        Describe the domain or purpose of your knowledge graph (optional).
      </p>
      <CodeEditor
        value={domain}
        onChange={onDomainChange}
        placeholder="e.g. Employee directory linking people to departments, roles, and office locations..."
        className="flex-1"
      />
    </div>
  );
}

// ── Step 3: Requirements ────────────────────────────────────────────────

interface ReqEntry extends CompetencyQuestion {
  enabled: boolean;
}

function StepRequirements({
  reqs,
  setReqs,
  isLoading,
  schemasLoading,
  hasError,
  onRetry,
}: {
  reqs: ReqEntry[];
  setReqs: React.Dispatch<React.SetStateAction<ReqEntry[]>>;
  isLoading: boolean;
  schemasLoading: boolean;
  hasError: boolean;
  onRetry: () => void;
}) {
  const addCustom = () => {
    setReqs((prev) => [
      ...prev,
      {
        id: `custom-${Date.now()}`,
        question: "",
        rationale: "Custom requirement",
        enabled: true,
      },
    ]);
  };

  const updateQuestion = (id: string, question: string) => {
    setReqs((prev) => prev.map((r) => (r.id === id ? { ...r, question } : r)));
  };

  const removeReq = (id: string) => {
    setReqs((prev) => prev.filter((r) => r.id !== id));
  };

  const rowSelection = useMemo(() => {
    const sel: RowSelectionState = {};
    for (const r of reqs) {
      if (r.enabled) sel[r.id] = true;
    }
    return sel;
  }, [reqs]);

  const columns: ColumnDef<ReqEntry>[] = useMemo(() => [
    { ...selectColumn<ReqEntry>(), size: 40 },
    {
      id: "requirement",
      header: "Requirement",
      cell: ({ row }) => (
        <div className="flex flex-col gap-0.5" onClick={(e) => e.stopPropagation()}>
          <Input
            value={row.original.question}
            onChange={(e) => updateQuestion(row.original.id, e.target.value)}
            placeholder="Type a requirement..."
            className="border-0 shadow-none focus-visible:ring-0 text-sm h-7 px-0"
          />
          <span className="text-xs text-muted-foreground">{row.original.rationale}</span>
        </div>
      ),
    },
    {
      id: "actions",
      size: 48,
      enableSorting: false,
      enableHiding: false,
      cell: ({ row }) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              onClick={(e) => e.stopPropagation()}
            >
              <MoreHorizontal className="h-4 w-4" />
              <span className="sr-only">Open menu</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation();
                removeReq(row.original.id);
              }}
              className="text-destructive focus:text-destructive"
            >
              Remove
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ], []); // eslint-disable-line react-hooks/exhaustive-deps

  const table = useReactTable({
    data: reqs,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (row) => row.id,
    onRowSelectionChange: (updater) => {
      const next = typeof updater === "function" ? updater(rowSelection) : updater;
      setReqs((prev) =>
        prev.map((r) => ({ ...r, enabled: !!next[r.id] })),
      );
    },
    state: { rowSelection },
  });

  if (isLoading || schemasLoading) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          {schemasLoading ? "Loading data schemas..." : "Generating requirements..."}
        </p>
      </div>
    );
  }

  if (reqs.length === 0 || hasError) {
    return (
      <EmptyState
        icon={Wand2}
        title={hasError ? "Generation failed" : "No requirements generated"}
        description={
          <>
            <button onClick={onRetry} className="underline underline-offset-4 hover:text-foreground">
              Try again
            </button>{" "}
            or add requirements manually.
          </>
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-3 h-full">
      <div className="flex items-center justify-between shrink-0">
        <p className="text-sm text-muted-foreground">
          Review and edit the requirements. These define what your knowledge graph should be able to answer.
        </p>
        <Button variant="outline" size="sm" onClick={addCustom} className="shrink-0 ml-4">
          <Plus className="h-3.5 w-3.5 mr-1.5" />
          Add requirement
        </Button>
      </div>
      <div className="flex-1 min-h-0 overflow-auto">
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((hg) => (
            <TableRow key={hg.id}>
              {hg.headers.map((h) => (
                <TableHead
                  key={h.id}
                  style={h.column.getSize() !== 150 ? { width: h.column.getSize() } : undefined}
                >
                  {h.isPlaceholder ? null : flexRender(h.column.columnDef.header, h.getContext())}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.map((row) => (
            <TableRow
              key={row.id}
              className={cn("cursor-pointer", !row.getIsSelected() && "opacity-50")}
              onClick={() => row.toggleSelected()}
            >
              {row.getVisibleCells().map((cell) => (
                <TableCell
                  key={cell.id}
                  style={cell.column.getSize() !== 150 ? { width: cell.column.getSize() } : undefined}
                >
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      </div>
    </div>
  );
}

// ── Step 4: Generate ────────────────────────────────────────────────────

function StepGenerate({ isLoading }: { isLoading: boolean }) {
  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Generating Fossil script and ShEx shapes...</p>
      </div>
    );
  }
  return null;
}

// ── Main Wizard ─────────────────────────────────────────────────────────

export function AssistantWizard({ onComplete, connections, providers }: AssistantWizardProps) {
  const [step, setStep] = useState(0);
  const [connRowSelection, setConnRowSelection] = useState<RowSelectionState>({});
  const [fileSelection, setFileSelection] = useState<Map<string, Set<string>>>(new Map());
  const [fileCounts, setFileCounts] = useState<Map<string, number>>(new Map());
  const [schemas, setSchemas] = useState<Map<string, ColumnInfo[]>>(new Map());
  const [domain, setDomain] = useState("");
  const [reqs, setReqs] = useState<ReqEntry[]>([]);

  const dataConnections = useMemo(
    () => connections.filter((c) => c.kind === "data"),
    [connections],
  );

  const selectedConnectionIds = useMemo(
    () => new Set(Object.keys(connRowSelection).filter((k) => connRowSelection[k])),
    [connRowSelection],
  );

  // Clean up file selection when connection is deselected
  useEffect(() => {
    setFileSelection((prev) => {
      let changed = false;
      const next = new Map(prev);
      for (const connId of next.keys()) {
        if (!selectedConnectionIds.has(connId)) {
          next.delete(connId);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [selectedConnectionIds]);

  // Deselect connection when all its files are deselected
  useEffect(() => {
    const toDeselect: string[] = [];
    for (const connId of selectedConnectionIds) {
      const total = fileCounts.get(connId);
      const selected = fileSelection.get(connId);
      // Only act once files have loaded (total known) and all are deselected
      if (total !== undefined && total > 0 && selected !== undefined && selected.size === 0) {
        toDeselect.push(connId);
      }
    }
    if (toDeselect.length > 0) {
      setConnRowSelection((prev) => {
        const next = { ...prev };
        for (const id of toDeselect) delete next[id];
        return next;
      });
    }
  }, [fileSelection, fileCounts, selectedConnectionIds]);

  const handleSupportedCount = useCallback((connId: string, count: number) => {
    setFileCounts((prev) => {
      if (prev.get(connId) === count) return prev;
      const next = new Map(prev);
      next.set(connId, count);
      return next;
    });
  }, []);

  const handleToggleFile = useCallback((connId: string, path: string) => {
    setFileSelection((prev) => {
      const next = new Map(prev);
      const set = new Set(next.get(connId) ?? []);
      if (set.has(path)) set.delete(path);
      else set.add(path);
      next.set(connId, set);
      return next;
    });
  }, []);

  const handleToggleAll = useCallback((connId: string, paths: string[]) => {
    setFileSelection((prev) => {
      const next = new Map(prev);
      const set = new Set(next.get(connId) ?? []);
      for (const p of paths) set.add(p);
      next.set(connId, set);
      return next;
    });
  }, []);

  // Determine supported extensions from providers
  const supportedExts = useMemo(
    () =>
      providers
        .filter((p) => p.kind === "data" || p.kind === "both")
        .flatMap((p) => p.extensions),
    [providers],
  );

  // Fetch schemas for selected files (parallel per connection)
  useEffect(() => {
    if (selectedConnectionIds.size === 0) return;
    let cancelled = false;
    async function fetchSchemas() {
      const fetches: { key: string; promise: Promise<{ columns: ColumnInfo[] }> }[] = [];
      for (const id of selectedConnectionIds) {
        if (schemas.has(id)) continue;
        const conn = connections.find((c) => c.id === id);
        if (!conn || conn.location_type !== "cloud") continue;
        const selectedPaths = fileSelection.get(id);
        if (!selectedPaths || selectedPaths.size === 0) continue;
        for (const path of selectedPaths) {
          const key = `${id}:${path}`;
          if (schemas.has(key)) continue;
          const ext = path.split(".").pop()?.toLowerCase() ?? "";
          if (supportedExts.length > 0 && !supportedExts.includes(ext)) continue;
          fetches.push({ key, promise: api.connections.schema(id, path) });
        }
      }
      const results = await Promise.allSettled(fetches.map((f) => f.promise));
      if (cancelled) return;
      setSchemas((prev) => {
        const next = new Map(prev);
        for (let i = 0; i < fetches.length; i++) {
          const result = results[i];
          if (result.status === "fulfilled") {
            next.set(fetches[i].key, result.value.columns);
          }
        }
        // Mark connections as visited
        for (const id of selectedConnectionIds) {
          if (!next.has(id)) next.set(id, []);
        }
        return next;
      });
    }
    fetchSchemas();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedConnectionIds, fileSelection]);

  const fileSchemas: FileSchema[] = useMemo(() => {
    const result: FileSchema[] = [];
    for (const [key, cols] of schemas) {
      if (!key.includes(":")) continue;
      const [connId, ...pathParts] = key.split(":");
      if (!selectedConnectionIds.has(connId)) continue;
      const filePath = pathParts.join(":");
      const selectedPaths = fileSelection.get(connId);
      if (selectedPaths && !selectedPaths.has(filePath)) continue;
      const conn = connections.find((c) => c.id === connId);
      if (!conn) continue;
      result.push({
        connection_name: conn.name,
        file_path: filePath,
        columns: cols,
      });
    }
    return result;
  }, [schemas, selectedConnectionIds, fileSelection, connections]);

  // Schemas are "ready" when all selected cloud connections have been visited
  const schemasReady = useMemo(() => {
    if (selectedConnectionIds.size === 0) return false;
    for (const id of selectedConnectionIds) {
      const conn = connections.find((c) => c.id === id);
      if (conn?.location_type === "cloud" && !schemas.has(id)) return false;
    }
    return true;
  }, [selectedConnectionIds, connections, schemas]);

  const suggestMutation = useMutation({
    mutationFn: () =>
      api.assistant.suggest({ domain, schemas: fileSchemas }),
    onSuccess: (data) => {
      setReqs(
        data.competency_questions.map((cq: CompetencyQuestion) => ({
          ...cq,
          enabled: true,
        })),
      );
    },
    onError: (err) => {
      toastError(err instanceof Error ? err.message : "Failed to suggest requirements");
    },
  });

  const generateMutation = useMutation({
    mutationFn: () =>
      api.assistant.generate({
        domain,
        competency_questions: reqs.filter((r) => r.enabled && r.question.trim()).map((r) => r.question),
        schemas: fileSchemas,
      }),
    onSuccess: (data) => {
      onComplete(data.script, data.shex);
      toast.success("Script generated — review before submitting");
    },
    onError: (err) => {
      toastError(err instanceof Error ? err.message : "Failed to generate script");
    },
  });

  useEffect(() => {
    if (step === 2 && reqs.length === 0 && !suggestMutation.isPending && !suggestMutation.isError && schemasReady) {
      suggestMutation.mutate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, schemasReady]);

  useEffect(() => {
    if (step === 3 && !generateMutation.isPending && !generateMutation.isSuccess && !generateMutation.isError) {
      generateMutation.mutate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const canNext = (() => {
    switch (step) {
      case 0:
        return selectedConnectionIds.size > 0;
      case 1:
        return true;
      case 2:
        return reqs.some((r) => r.enabled && r.question.trim());
      default:
        return false;
    }
  })();

  return (
    <PageShell>
      <PageShell.Content>
        <StepIndicator steps={STEPS} current={step} />

        <div className="flex-1 min-h-0 flex flex-col mt-4">
          {step === 0 && (
            <StepConnections
              connections={dataConnections}
              rowSelection={connRowSelection}
              onRowSelectionChange={setConnRowSelection}
              providers={providers}
              fileSelection={fileSelection}
              fileCounts={fileCounts}
              onToggleFile={handleToggleFile}
              onToggleAll={handleToggleAll}
              onSupportedCount={handleSupportedCount}
            />
          )}
          {step === 1 && <StepDescribe domain={domain} onDomainChange={setDomain} />}
          {step === 2 && (
            <StepRequirements
              reqs={reqs}
              setReqs={setReqs}
              isLoading={suggestMutation.isPending}
              schemasLoading={!schemasReady}
              hasError={suggestMutation.isError}
              onRetry={() => suggestMutation.mutate()}
            />
          )}
          {step === 3 && <StepGenerate isLoading={generateMutation.isPending} />}
        </div>
      </PageShell.Content>

      <PageShell.Footer>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setStep((s) => s - 1)}
          disabled={step === 0}
        >
          <ArrowLeft className="h-3.5 w-3.5 mr-1.5" />
          Back
        </Button>
        {step < 3 && (
          <Button size="sm" onClick={() => setStep((s) => s + 1)} disabled={!canNext}>
            {step === 2 ? (
              <>
                <Wand2 className="h-3.5 w-3.5 mr-1.5" />
                Generate
              </>
            ) : (
              <>
                Next
                <ArrowRight className="h-3.5 w-3.5 ml-1.5" />
              </>
            )}
          </Button>
        )}
      </PageShell.Footer>
    </PageShell>
  );
}
