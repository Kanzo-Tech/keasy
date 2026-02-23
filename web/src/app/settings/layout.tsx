import { SettingsNav } from "@/components/settings/settings-nav";

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col h-[calc(100dvh-3rem)]">
      <h2 className="text-2xl font-semibold mb-6 shrink-0">Settings</h2>
      <div className="flex gap-8 flex-1 min-h-0">
        <SettingsNav />
        <div className="flex-1 min-w-0 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}
