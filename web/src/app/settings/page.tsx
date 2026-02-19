"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { PreferencesTab } from "@/components/settings/preferences-tab";
import { CloudAccountsTab } from "@/components/settings/cloud-accounts-tab";
import { OrganizationTab } from "@/components/settings/organization-tab";
import { AiTab } from "@/components/settings/ai-tab";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default function SettingsPage() {
  return (
    <Suspense
      fallback={
        <div className="space-y-4">
          <Skeleton className="h-9 w-64" />
          <Skeleton className="h-40 w-full" />
        </div>
      }
    >
      <SettingsContent />
    </Suspense>
  );
}

function SettingsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeTab = searchParams.get("tab") || "preferences";

  function setTab(value: string) {
    router.replace(`/settings?tab=${value}`);
  }

  return (
    <>
      <PageHeader title="Settings" subtitle="Configure preferences, cloud accounts, and organization details." />
      <Tabs value={activeTab} onValueChange={setTab} className="gap-4">
        <TabsList variant="line">
          <TabsTrigger value="preferences">Preferences</TabsTrigger>
          <TabsTrigger value="cloud-accounts">Cloud Accounts</TabsTrigger>
          <TabsTrigger value="organization">Organization</TabsTrigger>
          <TabsTrigger value="ai">AI</TabsTrigger>
        </TabsList>

        <TabsContent value="preferences">
          <PreferencesTab />
        </TabsContent>
        <TabsContent value="cloud-accounts">
          <CloudAccountsTab />
        </TabsContent>
        <TabsContent value="organization">
          <OrganizationTab />
        </TabsContent>
        <TabsContent value="ai">
          <AiTab />
        </TabsContent>
      </Tabs>
    </>
  );
}
