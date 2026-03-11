import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { PageShell } from "@/components/layout/page-shell";
import { SettingsSection } from "@/components/settings/settings-section";

interface SettingsSectionSkeletonProps {
  title: string;
  description: string;
  searchPlaceholder: string;
  rows?: number;
}

export function SettingsSectionSkeleton({
  title,
  description,
  searchPlaceholder,
  rows = 3,
}: SettingsSectionSkeletonProps) {
  return (
    <PageShell>
      <PageShell.Content className="gap-8">
        <SettingsSection
          title={<Skeleton loading><span>{title}</span></Skeleton>}
          description={description}
        >
          <div className="space-y-2">
            <Skeleton loading className="block w-full">
              <Input disabled placeholder={searchPlaceholder} className="h-9" />
            </Skeleton>
            {Array.from({ length: rows }).map((_, i) => (
              <Skeleton loading key={i} className="block w-full">
                <div className="flex items-center gap-4 py-2.5 px-2">
                  <span className="text-sm font-medium">Placeholder</span>
                  <span className="text-sm text-muted-foreground ml-auto">Detail</span>
                </div>
              </Skeleton>
            ))}
          </div>
        </SettingsSection>
      </PageShell.Content>
    </PageShell>
  );
}
