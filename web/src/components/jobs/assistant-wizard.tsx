"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import {
  type ColumnDef,
  type RowSelectionState,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { experimental_useObject as useObject } from "@ai-sdk/react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import { competencyQuestionsSchema, generateScriptSchema } from "@/lib/ai/schemas";
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
import { CodeView } from "@/components/discovery/code-view";
import Link from "next/link";
import { AlertCircle, ArrowLeft, ArrowRight, Database, Loader2, MoreHorizontal, Plus, Wand2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { useDelayedLoading } from "@/hooks/use-delayed-loading";
import type {
  Connector,
  FileSchema,
  ProviderInfo,
} from "@/lib/types";
import { cn } from "@/lib/utils";
import { formatSize } from "@/lib/formatters";
import { StepIndicator } from "@/components/shared/step-indicator";
import { useAssistantWizardStore, type ReqEntry } from "./assistant-wizard-store";

interface AssistantWizardProps {
  onComplete: (script: string) => void;
  connectors: Connector[];
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
    queryKey: ["connections", connectionId, "files"],
    queryFn: () => Promise.resolve([] as { path: string; size: number; last_modified: string | null }[]),
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

  const showSkeleton = useDelayedLoading(isLoading);
  if (isLoading) {
    return showSkeleton ? (
      <>
        {Array.from({ length: 2 }).map((_, i) => (
          <TableRow key={i} className="bg-muted/30 hover:bg-muted/30">
            <TableCell className="pl-6"><Skeleton className="h-4 w-4" /></TableCell>
            <TableCell className="py-1.5"><Skeleton className="h-3 w-32" /></TableCell>
            <TableCell className="text-right"><Skeleton className="h-3 w-12 ml-auto" /></TableCell>
          </TableRow>
        ))}
      </>
    ) : null;
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
  connections: Connector[];
  rowSelection: RowSelectionState;
  onRowSelectionChange: (s: RowSelectionState) => void;
  providers: ProviderInfo[];
  fileSelection: Map<string, Set<string>>;
  fileCounts: Map<string, number>;
  onToggleFile: (connId: string, path: string) => void;
  onToggleAll: (connId: string, paths: string[]) => void;
  onSupportedCount: (connId: string, count: number) => void;
}) {
  const columns: ColumnDef<Connector>[] = useMemo(() => [
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
      accessorKey: "connector_type",
      header: "Type",
      cell: ({ getValue }) => (
        <span className="text-muted-foreground text-xs">{getValue<string>()}</span>
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
              {row.getIsSelected() && (
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

// ── Streaming preview (shared between step 2 & 3) ───────────────────────

function StreamingPreview({ label, text }: { label: string; text: string }) {
  return (
    <div className="flex-1 flex flex-col gap-3 min-h-0">
      <div className="flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">{label}</p>
      </div>
      {text && (
        <pre className="flex-1 min-h-0 overflow-auto text-xs font-mono text-muted-foreground bg-muted/30 rounded-md p-3 whitespace-pre-wrap">
          {text}
        </pre>
      )}
    </div>
  );
}

// ── Step 3: Requirements ────────────────────────────────────────────────

function StepRequirements({
  reqs,
  setReqs,
  isLoading,
  schemasLoading,
  hasError,
  onRetry,
  streamText,
}: {
  reqs: ReqEntry[];
  setReqs: (reqs: ReqEntry[]) => void;
  isLoading: boolean;
  schemasLoading: boolean;
  hasError: boolean;
  onRetry: () => void;
  streamText: string;
}) {
  const addCustom = () => {
    setReqs([
      ...reqs,
      {
        id: `custom-${Date.now()}`,
        question: "",
        rationale: "Custom requirement",
        enabled: true,
      },
    ]);
  };

  const updateQuestion = (id: string, question: string) => {
    setReqs(reqs.map((r) => (r.id === id ? { ...r, question } : r)));
  };

  const removeReq = (id: string) => {
    setReqs(reqs.filter((r) => r.id !== id));
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
      setReqs(reqs.map((r) => ({ ...r, enabled: !!next[r.id] })));
    },
    state: { rowSelection },
  });

  const showSchemaSkeleton = useDelayedLoading(schemasLoading);
  if (schemasLoading) {
    return showSchemaSkeleton ? (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-4 w-48" />
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3">
            <Skeleton className="h-4 w-4" />
            <div className="flex-1 space-y-1">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-3 w-2/3" />
            </div>
          </div>
        ))}
      </div>
    ) : null;
  }

  if (isLoading) {
    return <StreamingPreview label="Generating requirements..." text={streamText} />;
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

// ── Main Wizard ─────────────────────────────────────────────────────────

export function AssistantWizard({ onComplete, connectors, providers }: AssistantWizardProps) {
  // Zustand store — replaces 7 useState + sync effects
  const store = useAssistantWizardStore();
  const {
    step, connRowSelection, fileSelection, fileCounts,
    domain, reqs, setStep, setConnRowSelection, setDomain, setReqs,
    toggleFile, selectAllFiles, setSupportedCount,
    cleanupForDeselectedConnections, deselectEmptyConnections, reset,
  } = store;

  // Reset on unmount
  useEffect(() => () => reset(), [reset]);

  const sourceConnectors = useMemo(
    () => connectors.filter((c) => c.direction === "source" || c.direction === "both"),
    [connectors],
  );

  const selectedConnectionIds = useMemo(
    () => new Set(Object.keys(connRowSelection).filter((k) => connRowSelection[k])),
    [connRowSelection],
  );

  // Clean up file selection when connection is deselected
  useEffect(() => {
    cleanupForDeselectedConnections(selectedConnectionIds);
  }, [selectedConnectionIds, cleanupForDeselectedConnections]);

  // Deselect connection when all its files are deselected
  useEffect(() => {
    deselectEmptyConnections(selectedConnectionIds);
  }, [fileSelection, fileCounts, selectedConnectionIds, deselectEmptyConnections]);


  // Batch schema fetch: 1 request per connector via React Query
  const schemaQueryInputs = useMemo(() => {
    return [...selectedConnectionIds]
      .map((connId) => {
        const paths = [...(fileSelection.get(connId) ?? [])];
        return { connId, paths };
      })
      .filter((q) => q.paths.length > 0);
  }, [selectedConnectionIds, fileSelection]);

  const schemaQueries = useQueries({
    queries: schemaQueryInputs.map(({ connId, paths }) => ({
      queryKey: ["connections", connId, "schema", paths],
      queryFn: () => Promise.resolve({} as Record<string, { columns: { name: string; type: string }[]; error?: string }>),
      staleTime: Infinity,
      enabled: paths.length > 0,
    })),
  });

  const fileSchemas: FileSchema[] = useMemo(() => {
    const result: FileSchema[] = [];
    for (let i = 0; i < schemaQueryInputs.length; i++) {
      const { connId, paths } = schemaQueryInputs[i];
      const query = schemaQueries[i];
      if (!query.data) continue;
      const conn = connectors.find((c) => c.id === connId);
      if (!conn) continue;
      for (const path of paths) {
        const entry = query.data[path];
        if (entry?.columns?.length > 0) {
          result.push({
            connection_name: conn.name,
            file_path: path,
            columns: entry.columns,
          });
        }
      }
    }
    return result;
  }, [schemaQueryInputs, schemaQueries, connectors]);

  const schemasReady = selectedConnectionIds.size > 0
    && schemaQueries.length > 0
    && schemaQueries.every((q) => !q.isLoading);

  const suggest = useObject({
    api: "/api/ai/suggest",
    schema: competencyQuestionsSchema,
    onFinish: ({ object }) => {
      if (object?.competency_questions) {
        setReqs(object.competency_questions.map((cq) => ({ ...cq, enabled: true })));
      }
    },
  });

  const generate = useObject({
    api: "/api/ai/generate",
    schema: generateScriptSchema,
  });

  const generateRef = useRef(generate);
  generateRef.current = generate;

  const submitGenerate = useCallback(() => {
    generateRef.current.submit({
      domain,
      competency_questions: reqs
        .filter((r) => r.enabled && r.question.trim())
        .map((r) => r.question),
      schemas: fileSchemas,
    });
  }, [domain, reqs, fileSchemas]);

  useEffect(() => {
    if (step === 2 && reqs.length === 0 && !suggest.isLoading && !suggest.error && schemasReady) {
      suggest.submit({ domain, schemas: fileSchemas });
    }
    return suggest.stop;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, schemasReady]);

  useEffect(() => {
    if (step === 3 && !generate.isLoading && !generate.error) {
      submitGenerate();
    }
    return generate.stop;
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
              connections={sourceConnectors}
              rowSelection={connRowSelection}
              onRowSelectionChange={setConnRowSelection}
              providers={providers}
              fileSelection={fileSelection}
              fileCounts={fileCounts}
              onToggleFile={toggleFile}
              onToggleAll={selectAllFiles}
              onSupportedCount={setSupportedCount}
            />
          )}
          {step === 1 && <StepDescribe domain={domain} onDomainChange={setDomain} />}
          {step === 2 && (
            <StepRequirements
              reqs={reqs}
              setReqs={setReqs}
              isLoading={suggest.isLoading}
              schemasLoading={!schemasReady}
              hasError={!!suggest.error}
              onRetry={() => suggest.submit({ domain, schemas: fileSchemas })}
              streamText={suggest.object ? JSON.stringify(suggest.object, null, 2) : ""}
            />
          )}
          {step === 3 && (
            generate.isLoading ? (
              <StreamingPreview label="Generating Fossil script..." text={generate.object?.script ?? ""} />
            ) : generate.error ? (
              <EmptyState
                icon={AlertCircle}
                title="Generation failed"
                description={generate.error.message}
                action={<Button variant="outline" size="sm" onClick={submitGenerate}>Retry</Button>}
              />
            ) : generate.object?.script ? (
              <div className="flex-1 flex flex-col gap-3 min-h-0">
                <p className="text-xs text-muted-foreground">Review the generated script before accepting.</p>
                <div className="flex-1 min-h-0 overflow-auto rounded-md border">
                  <CodeView code={generate.object.script} lang="fossil" />
                </div>
              </div>
            ) : null
          )}
        </div>
      </PageShell.Content>

      <PageShell.Footer>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => store.prevStep()}
          disabled={step === 0}
        >
          <ArrowLeft className="h-3.5 w-3.5 mr-1.5" />
          Back
        </Button>
        {step < 3 ? (
          <Button size="sm" onClick={() => store.nextStep()} disabled={!canNext}>
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
        ) : !generate.isLoading && generate.object?.script ? (
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={submitGenerate}>
              Regenerate
            </Button>
            <Button size="sm" onClick={() => onComplete(generate.object!.script!)}>
              Accept & Edit
            </Button>
          </div>
        ) : null}
      </PageShell.Footer>
    </PageShell>
  );
}
