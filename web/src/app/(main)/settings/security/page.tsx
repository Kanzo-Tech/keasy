import { Shield } from "lucide-react";

export default function SecuritySettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-medium">Security</h2>
        <p className="text-sm text-muted-foreground">
          Manage your account security settings.
        </p>
      </div>

      <div className="rounded-lg border p-6">
        <div className="flex items-start gap-4">
          <Shield className="h-5 w-5 text-muted-foreground mt-0.5" />
          <div>
            <h3 className="text-base font-medium">Password &amp; Authentication</h3>
            <p className="text-sm text-muted-foreground mt-1">
              Your account is managed by your organization&apos;s identity
              provider. To change your password or manage your authentication
              settings, please contact your administrator.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
