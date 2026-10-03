import type { Schemas } from "@/lib/api/client";
import { cn } from "@kanzo-tech/ui";
import { formatDate, formatDay } from "@/lib/ui/format";

type Of = Schemas["Provenance"];

/** A day, the full date and time on hover. */
function Day({ at }: { at: string }) {
  return (
    <time dateTime={at} title={formatDate(at)}>
      {formatDay(at)}
    </time>
  );
}

/** "Created by Ana Duarte · 3 Oct 2026 · Updated by Bruno · 4 Oct 2026": a detail view's one line. */
export function Provenance({ of, className }: { of: Of; className?: string }) {
  return (
    <p className={cn("text-muted-foreground text-sm", className)}>
      Created by {of.created_by.name} · <Day at={of.created_at} />
      {of.updated_by && of.updated_at && (
        <>
          {" "}
          · Updated by {of.updated_by.name} · <Day at={of.updated_at} />
        </>
      )}
    </p>
  );
}

/** "Saved by Bruno · 4 Oct 2026": who saved it last. */
export function SavedBy({ of, className }: { of: Of; className?: string }) {
  const by = of.updated_by ?? of.created_by;
  const at = of.updated_at ?? of.created_at;
  return (
    <span className={cn("text-muted-foreground text-xs", className)}>
      Saved by {by.name} · <Day at={at} />
    </span>
  );
}

/** A list's "Created by" cell: the name, and the day under it. */
export function CreatedBy({ of }: { of: Of }) {
  return (
    <span className="flex flex-col">
      <span>{of.created_by.name}</span>
      <span className="text-muted-foreground text-xs">
        <Day at={of.created_at} />
      </span>
    </span>
  );
}
