"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import useSWR, { mutate } from "swr";
import QRCode from "react-qr-code";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardHeader,
  CardContent,
  CardDescription,
  CardTitle,
  CardFooter,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Wallet,
  Loader2,
  ExternalLink,
  Unplug,
  RefreshCw,
  CircleCheck,
} from "lucide-react";
import { SettingsPage, SettingsSection } from "@/components/settings/settings-section";

type WalletStatus = {
  connected: boolean;
  did: string | null;
  connected_at: string | null;
};

type ConnectStep = "idle" | "connecting" | "verifying" | "saving" | "done";

const QR_TIMEOUT_MS = 300_000; // 5 minutes
const POLL_INTERVAL_MS = 2_000;

function truncateDid(did: string): string {
  if (did.length <= 24) return did;
  return `${did.slice(0, 16)}...${did.slice(-8)}`;
}

export function WalletSettings() {
  const router = useRouter();

  const { data: wallet, isLoading: walletLoading } = useSWR<WalletStatus>(
    "wallet-status",
    () =>
      fetch("/v1/auth/wallet")
        .then((r) => r.json())
        .then((r) => r.data ?? r)
  );

  const { data: me } = useSWR("auth-me", () =>
    fetch("/v1/auth/me")
      .then((r) => r.json())
      .then((r) => r.data ?? r)
  );

  // Defense-in-depth: redirect promotors away from this page
  useEffect(() => {
    if (me?.effective_role === "promotor") {
      router.push("/settings");
    }
  }, [me, router]);

  const [step, setStep] = useState<ConnectStep>("idle");
  const [vcSession, setVcSession] = useState<{
    sessionId: string;
    qrUrl: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const qrTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
      if (qrTimerRef.current) clearTimeout(qrTimerRef.current);
    };
  }, []);

  const initConnect = useCallback(async () => {
    setError(null);
    setStep("connecting");
    setVcSession(null);

    try {
      const res = await fetch("/v1/auth/vc-init", { method: "POST" });
      if (!res.ok) {
        setError("Could not start wallet connection. Please try again.");
        setStep("idle");
        return;
      }
      const json = await res.json();
      const sessionId: string = json?.data?.session_id;
      const qrUrl: string = json?.data?.qr_url;

      if (!sessionId || !qrUrl) {
        setError("Invalid response from server. Please try again.");
        setStep("idle");
        return;
      }

      setVcSession({ sessionId, qrUrl });

      // Clear previous timers
      if (pollingRef.current) clearInterval(pollingRef.current);
      if (qrTimerRef.current) clearTimeout(qrTimerRef.current);

      // Start polling
      pollingRef.current = setInterval(async () => {
        try {
          const statusRes = await fetch(`/v1/auth/vc-status/${sessionId}`);
          if (!statusRes.ok) {
            setError("Verification failed. Please try again.");
            setStep("idle");
            if (pollingRef.current) clearInterval(pollingRef.current);
            if (qrTimerRef.current) clearTimeout(qrTimerRef.current);
            return;
          }
          const statusData = await statusRes.json();
          const status = statusData?.data?.status;

          if (status === "authenticated") {
            if (pollingRef.current) clearInterval(pollingRef.current);
            if (qrTimerRef.current) clearTimeout(qrTimerRef.current);
            setStep("saving");

            // Save wallet DID to user account
            const connectRes = await fetch("/v1/auth/vc-connect", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ session_id: sessionId }),
            });

            if (!connectRes.ok) {
              setError("Failed to save wallet connection. Please try again.");
              setStep("idle");
              return;
            }

            setStep("done");
            toast.success("Wallet connected");
            await mutate("wallet-status");
            await mutate("auth-me");
          } else if (status === "expired") {
            if (pollingRef.current) clearInterval(pollingRef.current);
            if (qrTimerRef.current) clearTimeout(qrTimerRef.current);
            setError("Session expired. Please try again.");
            setStep("idle");
          }
        } catch {
          // Network error — keep polling
        }
      }, POLL_INTERVAL_MS);

      // QR timeout after 5 minutes
      qrTimerRef.current = setTimeout(() => {
        if (pollingRef.current) clearInterval(pollingRef.current);
        setError("QR code expired after 5 minutes. Please try again.");
        setStep("idle");
        setVcSession(null);
      }, QR_TIMEOUT_MS);
    } catch {
      setError("Could not start wallet connection. Please try again.");
      setStep("idle");
    }
  }, []);

  const handleCancel = useCallback(() => {
    if (pollingRef.current) clearInterval(pollingRef.current);
    if (qrTimerRef.current) clearTimeout(qrTimerRef.current);
    setStep("idle");
    setVcSession(null);
    setError(null);
  }, []);

  const handleDisconnect = useCallback(async () => {
    try {
      const res = await fetch("/v1/auth/wallet", { method: "DELETE" });
      if (!res.ok) {
        toast.error("Failed to disconnect wallet. Please try again.");
        return;
      }
      toast.success("Wallet disconnected");
      await mutate("wallet-status");
      await mutate("auth-me");
    } catch {
      toast.error("Failed to disconnect wallet. Please try again.");
    }
  }, []);

  const stepLabel: Record<ConnectStep, string> = {
    idle: "",
    connecting: "Waiting for wallet scan...",
    verifying: "Verifying credentials...",
    saving: "Saving connection...",
    done: "Connected!",
  };

  return (
    <SettingsPage>
      <SettingsSection
        title="Wallet"
        description="Connect an external wallet to use Verifiable Credentials."
      >
      {walletLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading wallet status...
        </div>
      ) : wallet?.connected ? (
        /* Connected state */
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Connected Wallet</CardTitle>
              <Badge
                variant="secondary"
                className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
              >
                <CircleCheck className="mr-1 h-3 w-3" />
                Connected
              </Badge>
            </div>
            <CardDescription>
              Your wallet is connected and ready to use for Verifiable
              Credentials.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">DID</span>
                <span
                  className="font-mono text-xs"
                  title={wallet.did ?? undefined}
                >
                  {wallet.did ? truncateDid(wallet.did) : "—"}
                </span>
              </div>
              <Separator />
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Connected</span>
                <span className="text-xs">
                  {wallet.connected_at
                    ? new Date(wallet.connected_at).toLocaleDateString(
                        undefined,
                        {
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                        }
                      )
                    : "—"}
                </span>
              </div>
            </div>
          </CardContent>
          <CardFooter>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" size="sm">
                  <Unplug className="mr-2 h-4 w-4" />
                  Disconnect Wallet
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Disconnect Wallet?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Are you sure you want to disconnect your wallet? You will
                    no longer be able to use Verifiable Credentials for
                    authentication until you reconnect.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={handleDisconnect}>
                    Disconnect
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </CardFooter>
        </Card>
      ) : step === "idle" ? (
        /* Not connected idle state */
        <Card>
          <CardHeader>
            <CardTitle className="text-base">No Wallet Connected</CardTitle>
            <CardDescription>
              Connect your external wallet to use Verifiable Credentials for
              authentication and to prove your identity within the dataspace.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {error && (
              <div className="mb-4 rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">
                <p>{error}</p>
              </div>
            )}
            <div className="flex items-center gap-2">
              <Wallet className="h-8 w-8 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">
                Scan a QR code with your wallet app or open the deep link on
                your mobile device.
              </p>
            </div>
          </CardContent>
          <CardFooter className="flex gap-2">
            <Button onClick={initConnect}>
              <Wallet className="mr-2 h-4 w-4" />
              Connect Wallet
            </Button>
            {error && (
              <Button variant="outline" onClick={initConnect}>
                <RefreshCw className="mr-2 h-4 w-4" />
                Try Again
              </Button>
            )}
          </CardFooter>
        </Card>
      ) : (
        /* Connecting state */
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Connecting Wallet</CardTitle>
            <CardDescription>
              Scan the QR code below with your wallet app, or open the deep
              link on your mobile device.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {vcSession && (
              <div className="flex flex-col items-center gap-4">
                <div className="border rounded-lg p-4 bg-white">
                  <QRCode value={vcSession.qrUrl} size={200} level="M" />
                </div>

                <Button variant="outline" asChild>
                  <a href={vcSession.qrUrl}>
                    <ExternalLink className="mr-2 h-4 w-4" />
                    Open in Wallet App
                  </a>
                </Button>
              </div>
            )}

            <div className="flex items-center gap-2 justify-center text-sm text-muted-foreground">
              {step !== "done" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <CircleCheck className="h-4 w-4 text-green-500" />
              )}
              <span>{stepLabel[step]}</span>
            </div>
          </CardContent>
          <CardFooter>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleCancel}
              className="text-muted-foreground"
            >
              Cancel
            </Button>
          </CardFooter>
        </Card>
      )}
      </SettingsSection>
    </SettingsPage>
  );
}
