"use client";

import { useEffect, useState } from "react";
import { Compass, Copy, Ellipsis, Pencil, Play, RotateCcw, Square, Trash2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  Badge,
  Button,
  Clipboard,
  ClipboardTrigger,
  Menu,
  MenuContent,
  MenuItem,
  MenuTrigger,
  SectionActions,
  SectionDescription,
  SectionHeader,
  SectionTitle,
  SectionTitleGroup,
  Spinner,
  Status,
  toast,
} from "@kanzo-tech/ui";
import { useSession } from "@kanzo-tech/auth";
import { useRouter } from "@kanzo-tech/navigation/next";
import { useMutation } from "@tanstack/react-query";
import { http, invalidate, type Schemas } from "@/lib/api/client";
import { copyOf, toastError } from "@/lib/errors";
import { formatDate } from "@/lib/ui/format";
import { Blocked, BlockedMenuItem } from "@/components/blocked";
import { Provenance } from "@/components/provenance";
import { type Primary, primaryAction, runProblem, STATUS } from "@/lib/graphs";
import { blocked } from "@/lib/permissions";
import { lower, WORDS } from "@/lib/vocabulary";
import { folderSlug } from "@/app/(main)/(chrome)/(editor)/graphs/new/_parts/folder";
import { markInterrupted, startRun, useLiveRun } from "./use-browser-graph-runner";
import { useGraph } from "./use-graph";

const ICON = {
  edit: Pencil,
  run: Play,
  "run-again": RotateCcw,
  recover: RotateCcw,
  stop: Square,
  explore: Compass,
} as const;

/** Who runs it, as the person reading reads it. */
export function runnerName(runner: Schemas["Actor"], me: string | undefined): string {
  return runner.id === me ? "you" : runner.name;
}

/** Seconds since `iso`, ticking while `live`. */
function useSecondsSince(iso: string | undefined, live: boolean): number | undefined {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [live]);
  return iso ? Math.max(0, Math.round((now - new Date(iso).getTime()) / 1_000)) : undefined;
}

/** A value the header shows, and copies whole. */
function Copyable({ value, shown = value, label }: { value: string; shown?: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1 font-mono text-xs">
      {shown}
      <Clipboard className="w-auto" timeout={1200} value={value}>
        <ClipboardTrigger aria-label={`Copy ${label}`} />
      </Clipboard>
    </span>
  );
}

/** The graph's header: the same on every tab, whatever its state. */
export function GraphHeader({ id }: { id: string }) {
  const graph = useGraph(id);
  const router = useRouter();
  const { session, can } = useSession();
  const editor = can("editor");
  const me = session?.user.id;
  const live = useLiveRun(id);
  const [deleting, setDeleting] = useState(false);
  const primary = primaryAction(graph, { editor, me, runsHere: !!live });
  const seen = useSecondsSince(graph.heartbeat_at ?? undefined, graph.status === "running");

  const settle = () => invalidate("/v1/graphs", "/v1/graphs/{id}");

  // Run (again): the server makes this caller the runner, and this tab runs it.
  const run = useMutation({
    mutationFn: async ({ interrupted }: { interrupted: boolean }) => {
      if (interrupted) await markInterrupted(id);
      const { data } = await http.POST("/v1/graphs/{id}/run", { params: { path: { id } } });
      return data!;
    },
    onSuccess: async (started) => {
      startRun(started);
      await settle();
    },
    onError: async (err) => {
      toastError(err, `Could not ${lower(WORDS.run)} the ${lower(WORDS.graph)}`);
      await settle();
    },
  });

  // Stop: here, at once, when this tab runs it; elsewhere, asked of whoever runs it.
  const stop = useMutation({
    mutationFn: async () => {
      if (live) return live.stop();
      await http.POST("/v1/graphs/{id}/stop", { params: { path: { id } } });
    },
    onSettled: settle,
    onError: (err) => toastError(err, "Could not stop the run"),
  });

  const remove = useMutation({
    mutationFn: () => http.DELETE("/v1/graphs/{id}", { params: { path: { id } } }),
    onSuccess: async () => {
      toast.create({ title: `${WORDS.graph} deleted`, type: "success" });
      await invalidate("/v1/graphs");
      router.push("/graphs");
    },
    onError: (err) => toastError(err, `Could not delete the ${lower(WORDS.graph)}`),
  });

  // Duplicate: a new draft of the same recipe, writing to a folder of its own.
  const duplicate = useMutation({
    mutationFn: async () => {
      const name = `${graph.name ?? graph.id.slice(0, 8)} copy`;
      const { data } = await http.POST("/v1/graphs", {
        body: {
          name,
          script: graph.script ?? "",
          sink_connection: graph.sink_connection,
          folder: `${folderSlug(name).slice(0, 40)}-${crypto.randomUUID().slice(0, 6)}`,
        },
      });
      return data!;
    },
    onSuccess: async (copy) => {
      await invalidate("/v1/graphs");
      router.push(`/graphs/new?draft=${copy.id}`);
    },
    onError: (err) => toastError(err, `Could not duplicate the ${lower(WORDS.graph)}`),
  });

  const busy = run.isPending || stop.isPending;
  const act = (p: Primary) => {
    switch (p.kind) {
      case "edit":
        return router.push(`/graphs/new?draft=${id}`);
      case "run":
      case "run-again":
        return run.mutate({ interrupted: false });
      case "recover":
        return run.mutate({ interrupted: true });
      case "stop":
        return stop.mutate();
      case "explore":
        return router.push(`/graphs/${id}/discover`);
    }
  };
  const Icon = ICON[primary.kind];

  const { label, variant } = STATUS[graph.status];
  // A failure keasy has its own words for says them; any other says "Failed".
  const worded = graph.status === "failed" ? copyOf(runProblem(graph)?.code ?? "")?.title : undefined;

  return (
    <>
      <SectionHeader scale="page">
        <SectionTitleGroup>
          <div className="flex min-w-0 items-center gap-2">
            <SectionTitle className="truncate" level={1} scale="page">
              {graph.name ?? graph.id.slice(0, 8)}
            </SectionTitle>
            <Badge variant={worded ? "destructive" : variant}>{worded ?? label}</Badge>
          </div>
          <SectionDescription asChild>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <span className="flex flex-wrap gap-x-1">
                <Provenance of={graph} />
                {graph.runner && graph.started_at && (
                  <span>
                    · last {lower(WORDS.run)} by {runnerName(graph.runner, me)}, {formatDate(graph.started_at)}
                  </span>
                )}
              </span>
              {graph.output && (
                <Copyable label={`the ${lower(WORDS.output)} location`} value={graph.output} />
              )}
              <Copyable label={`the ${lower(WORDS.graph)}'s id`} shown={graph.id.slice(0, 8)} value={graph.id} />
            </div>
          </SectionDescription>
          {graph.status === "running" && (
            <SectionDescription className="flex items-center gap-2">
              <Status variant={graph.cancel_requested ? "warning" : "info"} />
              {graph.cancel_requested ? "Stopping" : "Running"}
              {graph.runner && ` · ${runnerName(graph.runner, me)}`}
              {seen !== undefined && ` · seen ${seen} s ago`}
            </SectionDescription>
          )}
        </SectionTitleGroup>
        <SectionActions>
          <Blocked reason={primary.blocked}>
            <Button
              disabled={!!primary.blocked || busy}
              onClick={() => act(primary)}
              size="sm"
              variant={primary.kind === "stop" ? "outline" : "default"}
            >
              {busy ? <Spinner /> : <Icon />}
              {primary.label}
            </Button>
          </Blocked>
          {/* A reader can do nothing more than the primary action: no menu to open empty. */}
          {editor && (
            <Menu>
              <MenuTrigger asChild>
                <Button aria-label={`More ${lower(WORDS.graph)} actions`} size="icon-sm" variant="outline">
                  <Ellipsis />
                </Button>
              </MenuTrigger>
              <MenuContent>
                <MenuItem disabled={duplicate.isPending} onSelect={() => duplicate.mutate()} value="duplicate">
                  <Copy />
                  Duplicate
                </MenuItem>
                <BlockedMenuItem
                  disabled={graph.status === "running"}
                  onSelect={() => setDeleting(true)}
                  reason={blocked(graph, "manage", lower(WORDS.graph))}
                  value="delete"
                  variant="destructive"
                >
                  <Trash2 />
                  {graph.status === "running" ? "Delete (stop the run first)" : "Delete"}
                </BlockedMenuItem>
              </MenuContent>
            </Menu>
          )}
        </SectionActions>
      </SectionHeader>

      <AlertDialog onOpenChange={(d) => setDeleting(d.open)} open={deleting}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader
            description={`${graph.name ?? graph.id} and its record go. Its ${lower(WORDS.output)} stays in ${lower(WORDS.storage)}.`}
            title={`Delete this ${lower(WORDS.graph)}?`}
          />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => remove.mutate()} variant="destructive">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
