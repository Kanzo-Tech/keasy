import { Shield } from "lucide-react";
import { SettingsSection } from "@/components/settings/settings-section";
import { PageShell } from "@/components/layout/page-shell";

export default function SecuritySettingsPage() {
  return (
    <PageShell>
      <PageShell.Content className="gap-8">
        <SettingsSection
          title="Password & Authentication"
          description="Your account is managed by your organization's identity provider."
        >
          <div className="rounded-lg border p-6">
            <div className="flex items-start gap-4">
              <Shield className="h-5 w-5 text-muted-foreground mt-0.5" />
              <p className="text-sm text-muted-foreground">
                To change your password or manage your authentication settings,
                please contact your administrator.
              </p>
            </div>
          </div>
        </SettingsSection>
      </PageShell.Content>
    </PageShell>
  );
}
