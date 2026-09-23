import { Skeleton } from "@kanzo-tech/ui";
import { PageShell } from "@/components/layout/page-shell";
import { SettingsSection } from "@/components/settings/settings-section";

interface SettingsSectionSkeletonProps {
  description: string;
  rows?: number;
}

/**
 * The section's shape while its rows load. The title and the search box are placeholders
 * rather than the real strings under a veil: the design system's `Skeleton` is a box, not a
 * wrapper that hides its children, so there is nothing to size it against.
 */
export function SettingsSectionSkeleton({
  description,
  rows = 3,
}: SettingsSectionSkeletonProps) {
  return (
    <PageShell>
      <PageShell.Content className="gap-8">
        <SettingsSection
          description={description}
          title={<Skeleton className="h-5 w-40" />}
        >
          <div className="space-y-2">
            <Skeleton className="h-9 w-full" />
            {Array.from({ length: rows }).map((_, i) => (
              <Skeleton className="h-10 w-full" key={i} />
            ))}
          </div>
        </SettingsSection>
      </PageShell.Content>
    </PageShell>
  );
}
