import { OrgNav } from "@/components/organization/org-nav";
import { SidebarContentLayout } from "@/components/layout/sidebar-content-layout";

export default function OrgSettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <SidebarContentLayout nav={<OrgNav />}>
      {children}
    </SidebarContentLayout>
  );
}
