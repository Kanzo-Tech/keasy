import { Skeleton } from "@/components/ui/skeleton";
import { PageShell } from "@/components/layout/page-shell";

export function FormPageSkeleton() {
  return (
    <PageShell>
      <PageShell.Content>
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-40 w-full" />
      </PageShell.Content>
    </PageShell>
  );
}
