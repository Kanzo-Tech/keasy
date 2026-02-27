import { Shield } from "lucide-react";
import { SettingsPage, SettingsSection } from "@/components/settings/settings-section";

export default function SecuritySettingsPage() {
  return (
    <SettingsPage>
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
    </SettingsPage>
  );
}
