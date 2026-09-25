import { Badge } from "@kanzo-tech/ui";
import type { Schemas } from "@/lib/api/client";
import { validationStatus } from "@/lib/connections";

/** The last probe's outcome; its failures on hover. */
export function ValidationBadge({ report }: { report?: Schemas["ValidationReport"] | null }) {
  const status = validationStatus(report);
  const failures = report?.results
    .filter((c) => c.result === "fail")
    .map((c) => `${c.operation}: ${c.message ?? "failed"}`)
    .join("\n");
  if (status === "unchecked") return <Badge variant="outline">Not checked</Badge>;
  return (
    <Badge title={failures || report?.at} variant={status === "passed" ? "success" : "destructive"}>
      {status === "passed" ? "Validated" : "Failing"}
    </Badge>
  );
}
