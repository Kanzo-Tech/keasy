"use client";

import type * as React from "react";
import { EllipsisIcon, RotateCwIcon, ShieldCheckIcon, SquareIcon, UploadIcon } from "lucide-react";
import {
  Button,
  cn,
  type FindingPlace,
  type FindingTally,
  FileUpload,
  FileUploadDropzone,
  FileUploadHiddenInput,
  FileUploadTrigger,
  FindingsActions,
  FindingsBadge,
  FindingsContent,
  FindingsGroup,
  FindingsHeader,
  FindingsItem,
  FindingsList,
  FindingsRoot,
  FindingsSource,
  Menu,
  MenuContent,
  MenuGroup,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
  PopoverDescription,
  Skeleton,
  Toggle,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  useFileUpload,
  usePopover,
} from "@kanzo-tech/ui";
import type { RdfPlace } from "@kanzo-tech/rudof-wasm";
import { ProblemView } from "@/components/problem-view";
import { SavedBy } from "@/components/provenance";
import { $api,  type Schemas } from "@/lib/api/client";
import { queryClient } from "@/lib/api/query-client";
import { settled } from "@/lib/api/settled";
import { toastError } from "@/lib/errors";
import { useParams } from "next/navigation";
import { groupKey, type Rule, rulesOf, type Stale, tallyOf, useReadRules, useRules } from "./rules-validation";

/**
 * The graph's rules as a badge in the filter bar — the recipe editor's findings badge, read in Graph
 * and Dashboard alike — and the work in its popover. The rules are one SHACL file the server keeps:
 * dropping a `.ttl` anywhere on the popover, or *Replace rules…* in its menu, replaces it, and a file
 * rudof cannot read is refused with its line and column while the previous one stays. rudof validates
 * the corpus over the page's subset; the popover lists rudof's groups under their rule, and each
 * *Show N* — of a rule, of one of its groups — or *Keep what conforms* puts the vertices on the page
 * as the rules' one clause. `/docs/design/findings` in kanzo-ui is the model.
 */
export function RulesBadge() {
  const { id: graphId } = useParams<{ id: string }>();
  const init = { params: { path: { id: graphId } } };
  const read = $api.queryOptions("get", "/v1/graphs/{id}/rules", init);
  const saved = settled($api.useSuspenseQuery("get", "/v1/graphs/{id}/rules", init));
  // Everyone reads the rules; only whoever manages the graph replaces them.
  const { can } = settled($api.useSuspenseQuery("get", "/v1/graphs/{id}", init));

  const save = $api.useMutation("put", "/v1/graphs/{id}/rules", {
    onSuccess: (written) => queryClient.setQueryData(read.queryKey, written),
  });
  const upload = async (file: File) => save.mutate({ ...init, body: { name: file.name, shapes: await file.text() } });

  return (
    // `contents`: the root is only where the file input and its context live; the badge sits in the bar.
    <FileUpload
      accept=".ttl"
      className="contents"
      disabled={!can.manage || save.isPending}
      maxFiles={1}
      onFileAccept={({ files: [file] }) => file && void upload(file)}
    >
      {/* One badge whether or not there is a file yet: saving the first one changes its words, and
          the popover it opens stays the one that is open. */}
      <Checked can_manage={can.manage} refused={save.error} saved={saved ?? undefined} />
      <FileUploadHiddenInput />
    </FileUpload>
  );
}

/** The badge: the shield, the words, and — while the last check is out of date — that it is, dashed. */
function Badge({ children, stale }: { children: string; stale?: Stale }) {
  return (
    <FindingsBadge className={cn("gap-1", stale && "border-dashed opacity-70")} data-stale={stale} size="sm" title={stale && STALE[stale]}>
      <ShieldCheckIcon aria-hidden className="size-3" />
      {children}
      {stale && <span className="sr-only">, out of date</span>}
    </FindingsBadge>
  );
}

function NoRules({ can_manage }: { can_manage: boolean }) {
  if (!can_manage) return <p className="text-muted-foreground text-sm">The graph has no rules yet.</p>;
  return (
    <FileUploadDropzone className="items-center gap-1 px-3 py-6 text-center" disableClick>
      <UploadIcon aria-hidden className="size-4" />
      <p className="text-foreground text-sm">
        Drop a SHACL shapes graph here, or{" "}
        <FileUploadTrigger className="h-auto p-0" size="sm" variant="link">
          browse
        </FileUploadTrigger>
      </p>
      <p className="text-xs">Turtle (.ttl). The graph has no rules yet.</p>
    </FileUploadDropzone>
  );
}

/** The plural a severity reads in, in the badge's tally. */
const NOUN = { violation: ["violation", "violations"], warning: ["warning", "warnings"], info: ["note", "notes"] } as const;

/** *2 violations · 3 warnings*: the badge's words, and so its name. */
function tallyWords(tally: FindingTally): string {
  return (["violation", "warning", "info"] as const)
    .filter((severity) => tally[severity] > 0)
    .map((severity) => `${tally[severity].toLocaleString()} ${NOUN[severity][tally[severity] === 1 ? 0 : 1]}`)
    .join(" · ");
}

/** The clause *Keep what conforms* puts on the page. */
const CONFORMS = "Conforms to the rules";

/** Why the last check is out of date, as the popover says it. */
const STALE: Record<Stale, string> = {
  filter: "Filter changed since the last check",
  rules: "Rules changed since the last check",
};

/**
 * The rules file, read, and checked when asked: the badge's tally — kept, and marked out of date,
 * once a filter or the file moves past it — and the popover's groups.
 */
function Checked({ saved, can_manage, refused }: { saved: Schemas["Rules"] | undefined; can_manage: boolean; refused: unknown }) {
  const { rules: read, failure: unreadable } = useReadRules(saved?.shapes);
  const rulesCheck = useRules(read, saved?.shapes ?? "");
  const { checked, checking, failure, picked, withdraw, conforming } = rulesCheck;
  const upload = useFileUpload();
  const rules = read && checked ? rulesOf(read.model, checked.findings) : undefined;
  const tally = rules ? tallyOf(rules) : undefined;
  const words = !saved
    ? "No rules"
    : unreadable !== undefined
      ? "Rules unreadable"
      : checking
        ? "Checking rules…"
        : !tally
          ? "Not checked"
          : tally.total === 0
            ? "Conforms to the rules"
            : tallyWords(tally);

  const failed = (err: unknown) => toastError(err, "The graph could not show them");
  const toggle = (label: string, publish: () => Promise<void>) =>
    picked === label ? withdraw() : void publish().catch(failed);
  /** A Show: toggles the clause `label`, and reads pressed while it holds. */
  const show = (n: number, label: string, publish: () => Promise<void>) => ({
    label: `Show ${n.toLocaleString()}`,
    pressed: picked === label,
    run: () => toggle(label, publish),
  });

  const problem = !saved ? (
    <>
      {refused != null && <ProblemView error={refused} uncoded="rules/refused" />}
      <NoRules can_manage={can_manage} />
    </>
  ) : unreadable !== undefined ? (
      <ProblemView error={unreadable} uncoded="rules/refused" />
    ) : failure !== undefined ? (
      <ProblemView error={failure} uncoded="query/failed" />
    ) : !rules ? (
      checking ? (
        <Skeleton className="h-32" />
      ) : (
        <p className="text-muted-foreground text-sm">Not checked yet. Check validates what the page holds now.</p>
      )
    ) : undefined;

  return (
    <FindingsRoot tally={tally}>
      <Badge stale={rulesCheck.stale}>{words}</Badge>
      <FindingsContent
        // A `.ttl` dropped anywhere on the popover replaces the file, for whoever may; the upload's
        // own checks — the type, one file, who may — apply as they do to the menu's picker. With no
        // file yet the list is a drop zone of its own, which handles its drop.
        onDragOver={(event) => saved && can_manage && event.preventDefault()}
        onDrop={(event) => {
          if (!saved || !can_manage) return;
          event.preventDefault();
          upload.setFiles([...event.dataTransfer.files]);
        }}
      >
        <FindingsHeader>
          {saved && (
            <RulesHeader
              can_manage={can_manage}
              check={read ? rulesCheck : undefined}
              conforms={{ pressed: picked === CONFORMS, toggle: () => toggle(CONFORMS, () => conforming(CONFORMS)) }}
              count={read?.model.nodeShapes.length}
              refused={refused}
              saved={saved}
            />
          )}
        </FindingsHeader>
        <FindingsList empty={problem ?? <AllConform rules={rules ?? []} />}>
          {problem === undefined &&
            rules?.map((rule) => {
              const label = `Breaks ${rule.name}`;
              const n = checked?.flagged[rule.id] ?? 0;
              return (
                <FindingsGroup
                  action={n > 0 ? show(n, label, () => rulesCheck.showRule(rule, label)) : undefined}
                  key={rule.id}
                  tally={rule.tally}
                  title={rule.name}
                >
                  <RuleState rule={rule} />
                  {rule.groups.map((group) => {
                    const label = `${rule.name}: ${group.message}`;
                    return (
                      <FindingsItem
                        action={show(group.vertices, label, () => rulesCheck.showGroup(rule, group, label))}
                        describe={describe}
                        finding={group}
                        key={groupKey(group)}
                      />
                    );
                  })}
                </FindingsGroup>
              );
            })}
        </FindingsList>
      </FindingsContent>
    </FindingsRoot>
  );
}

/** A sampled node, as its group reads it once opened: the node and its value. Read, not acted on. */
function describe(place: RdfPlace): FindingPlace {
  return {
    where: place.focus.value,
    detail: place.value ? `Value: ${place.value.value}` : undefined,
  };
}

/** A rule's state when it has no group to list: off, not checked, or in order. */
function RuleState({ rule }: { rule: Rule }) {
  const state = rule.off ? "Off" : rule.unchecked ? `Not checked: ${rule.unchecked}` : rule.groups.length === 0 ? "In order" : undefined;
  if (!state) return null;
  return <li className="text-muted-foreground text-xs" data-slot="rule-state">{state}</li>;
}

/** Nothing found: each rule, in order, off or not checked. */
function AllConform({ rules }: { rules: Rule[] }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm">Every node checked conforms to the rules.</p>
      {rules.map((rule) => (
        <FindingsGroup key={rule.id} tally={rule.tally} title={rule.name}>
          <RuleState rule={rule} />
        </FindingsGroup>
      ))}
    </div>
  );
}

/** An icon button named by its tooltip: the header's controls, as the filter bar's verbs are. */
function IconButton({ label, children, ...rest }: Omit<React.ComponentProps<typeof Button>, "aria-label" | "size" | "variant"> & { label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button aria-label={label} size="icon-sm" variant="ghost" {...rest}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

interface RulesHeaderProps {
  saved: Schemas["Rules"];
  count: number | undefined;
  can_manage: boolean;
  refused: unknown;
  /** The check, once the file is read: what it was over, whether it runs, and its controls. */
  check: Pick<ReturnType<typeof useRules>, "checked" | "checking" | "stale" | "check" | "stop"> | undefined;
  conforms: { pressed: boolean; toggle: () => void };
}

/**
 * The header's parts after its title, above the list and not scrolling with it: the file — its name
 * and how many rules — then the controls, *Check* (*Check again*, *Stop* while it runs) and a menu
 * with *Replace rules…* and who saved the file; then, on a line of its own, what the last check was
 * over and how much of it conforms — in the warning colour, with the reason, once a filter or the
 * file has moved past it — and *Keep what conforms*.
 */
function RulesHeader({ saved, count, can_manage, refused, check, conforms }: RulesHeaderProps) {
  const popover = usePopover();
  const upload = useFileUpload();
  const checked = check?.checked;
  const stale = check?.checking ? undefined : check?.stale;
  const scope = check?.checking
    ? "Checking what the page holds…"
    : checked
      ? `${checked.inScope === checked.total ? "All" : `${checked.inScope.toLocaleString()} of`} ${checked.total.toLocaleString()} nodes checked · ${(checked.inScope - checked.broken).toLocaleString()} conform`
      : "Not checked";
  return (
    <>
      <FindingsSource>
        {saved.name}
        {count !== undefined && ` · ${count} ${count === 1 ? "rule" : "rules"}`}
      </FindingsSource>
      <FindingsActions>
        {check &&
          (check.checking ? (
            <IconButton label="Stop" onClick={check.stop}>
              <SquareIcon />
            </IconButton>
          ) : (
            <IconButton label={checked ? "Check again" : "Check"} onClick={() => void check.check()}>
              <RotateCwIcon />
            </IconButton>
          ))}
        <Menu>
          <Tooltip>
            <TooltipTrigger asChild>
              <MenuTrigger asChild>
                <Button aria-label="The rules file" size="icon-sm" variant="ghost">
                  <EllipsisIcon />
                </Button>
              </MenuTrigger>
            </TooltipTrigger>
            <TooltipContent>The rules file</TooltipContent>
          </Tooltip>
          <MenuContent>
            {can_manage && (
              <>
                <MenuItem onClick={() => upload.openFilePicker()} value="replace">
                  Replace rules…
                </MenuItem>
                <MenuSeparator />
              </>
            )}
            <MenuGroup>
              <p className="px-2 py-1.5">
                <SavedBy of={saved} />
              </p>
            </MenuGroup>
          </MenuContent>
        </Menu>
      </FindingsActions>
      {refused != null && (
        <div className="flex basis-full flex-col gap-1">
          <ProblemView error={refused} uncoded="rules/refused" />
          <p className="text-muted-foreground text-xs">Nothing changed: the graph keeps {saved.name}.</p>
        </div>
      )}
      {check && (
        <div className="flex basis-full items-center gap-2">
          <PopoverDescription className={cn("min-w-0 flex-1 text-xs", stale && "text-warning")}>
            <span data-slot="rules-scope">{scope}</span>
            {stale && <span data-slot="rules-stale"> · {STALE[stale]}</span>}
          </PopoverDescription>
          <Toggle
            className="shrink-0"
            onPressedChange={() => {
              // As a Show does: the popover closes, and the page shows what it put there.
              popover.setOpen(false);
              conforms.toggle();
            }}
            pressed={conforms.pressed}
            size="sm"
            variant="outline"
          >
            Keep what conforms
          </Toggle>
        </div>
      )}
    </>
  );
}
