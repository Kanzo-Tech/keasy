"use client";

import { useState } from "react";
import useSWR from "swr";
import QRCode from "react-qr-code";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Download, Loader2, CheckCircle, Wallet, ExternalLink } from "lucide-react";
import { ServiceGate } from "@/components/ui/service-gate";
import { WalletConnectionCard } from "@/components/wallet/wallet-connection-card";
import {
  fetchWalletStatus,
  createCredentialOffer,
  ApiError,
} from "@/lib/api";
import { useServices } from "@/hooks/use-services";
import type { WalletStatus } from "@/lib/types";

type ExportStep = "idle" | "creating" | "ready" | "error";

export function WalletExportSection() {
  const { services } = useServices();
  const { data: wallet } = useSWR<WalletStatus>("wallet-status", fetchWalletStatus);

  const [exportStep, setExportStep] = useState<ExportStep>("idle");
  const [offerUrl, setOfferUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const issuerAvailable = services?.issuer === true;

  const handleExport = async () => {
    setExportStep("creating");
    setError(null);
    setOfferUrl(null);

    try {
      const result = await createCredentialOffer();
      setOfferUrl(result.offer_url);
      setExportStep("ready");
      toast.success("Credential offer created");
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Failed to create credential offer";
      setError(msg);
      setExportStep("error");
    }
  };

  return (
    <ServiceGate requires="wallet">
      <div className="space-y-4">
        <div>
          <h3 className="text-lg font-semibold">Export to Wallet</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Export your Gaia-X compliance credentials to an external wallet via OID4VCI.
          </p>
        </div>

        {!wallet?.connected ? (
          <WalletConnectionCard />
        ) : (
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Wallet Connected</CardTitle>
                <Badge
                  variant="secondary"
                  className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                >
                  <CheckCircle className="mr-1 h-3 w-3" />
                  Connected
                </Badge>
              </div>
              <CardDescription>
                {wallet.did && (
                  <span className="font-mono text-xs">{wallet.did}</span>
                )}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {!issuerAvailable ? (
                <p className="text-sm text-muted-foreground">
                  Credential issuer is not configured. Contact your administrator to enable OID4VCI export.
                </p>
              ) : exportStep === "idle" || exportStep === "error" ? (
                <div className="space-y-3">
                  {error && (
                    <div className="rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">
                      {error}
                    </div>
                  )}
                  <Button onClick={handleExport}>
                    <Download className="mr-2 h-4 w-4" />
                    Export Credentials
                  </Button>
                </div>
              ) : exportStep === "creating" ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Creating credential offer...
                </div>
              ) : offerUrl ? (
                <div className="space-y-4">
                  <Separator />
                  <p className="text-sm font-medium">Scan with your wallet to receive credentials</p>
                  <div className="flex flex-col items-center gap-4">
                    <div className="border rounded-lg p-4 bg-white">
                      <QRCode value={offerUrl} size={200} level="M" />
                    </div>
                    <Button variant="outline" asChild>
                      <a href={offerUrl}>
                        <ExternalLink className="mr-2 h-4 w-4" />
                        Open in Wallet App
                      </a>
                    </Button>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setExportStep("idle");
                      setOfferUrl(null);
                    }}
                    className="text-muted-foreground"
                  >
                    Done
                  </Button>
                </div>
              ) : null}
            </CardContent>
          </Card>
        )}
      </div>
    </ServiceGate>
  );
}
