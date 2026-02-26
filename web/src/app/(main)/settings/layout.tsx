import { SettingsNav } from "@/components/settings/settings-nav";

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-full w-full gap-4">
      <aside className="w-1/5 min-w-50 max-w-62.5">
        <SettingsNav />
      </aside>

      <div className="flex-1 min-w-0">
        <div className="max-w-3xl mx-auto">{children}</div>
      </div>
    </div>
  );
}
