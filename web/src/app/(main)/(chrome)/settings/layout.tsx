import { SettingsNav } from "@/components/settings/settings-nav";
import { SidebarContentLayout } from "@/components/layout/sidebar-content-layout";

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <SidebarContentLayout nav={<SettingsNav />}>
      {children}
    </SidebarContentLayout>
  );
}
