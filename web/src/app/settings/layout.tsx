import { SettingsNav } from "@/components/settings/settings-nav";
import { ScrollArea } from "@/components/ui/scroll-area";

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ScrollArea className="flex-1 min-h-0">
      <h2 className="text-2xl font-semibold mb-6">Settings</h2>
      <div className="flex gap-8">
        <div className="sticky top-0 self-start shrink-0">
          <SettingsNav />
        </div>
        <div className="flex-1 min-w-0">{children}</div>
      </div>
    </ScrollArea>
  );
}
