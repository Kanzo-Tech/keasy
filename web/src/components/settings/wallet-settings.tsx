"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { SettingsPage, SettingsSection } from "@/components/settings/settings-section";
import { ServiceGate } from "@/components/ui/service-gate";
import { WalletConnectionCard } from "@/components/wallet/wallet-connection-card";
import { fetchAuthMe } from "@/lib/api";

export function WalletSettings() {
  const router = useRouter();
  const { data: me } = useSWR("auth-me", fetchAuthMe);

  // Defense-in-depth: redirect non-org_admin users away from this page
  useEffect(() => {
    if (me && me.effective_role !== "org_admin") {
      router.push("/settings");
    }
  }, [me, router]);

  return (
    <SettingsPage>
      <SettingsSection
        title="Wallet"
        description="Connect an external wallet to use Verifiable Credentials."
      >
        <ServiceGate requires="wallet">
          <WalletConnectionCard />
        </ServiceGate>
      </SettingsSection>
    </SettingsPage>
  );
}
