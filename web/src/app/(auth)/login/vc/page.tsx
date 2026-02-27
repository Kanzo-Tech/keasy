"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import QRCode from "react-qr-code";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

type Step = "idle" | "scan" | "verifying" | "done";

const QR_TIMEOUT_MS = 300_000; // 5 minutes
const POLL_INTERVAL_MS = 2_000;

export default function VcLoginPage() {
  const router = useRouter();
  const [vcSession, setVcSession] = useState<{
    sessionId: string;
    qrUrl: string;
  } | null>(null);
  const [step, setStep] = useState<Step>("idle");
  const [error, setError] = useState<string | null>(null);
  const [qrExpired, setQrExpired] = useState(false);
  const [loading, setLoading] = useState(false);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const qrTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function initSession() {
    setError(null);
    setQrExpired(false);
    setLoading(true);
    setStep("scan");

    try {
      const res = await fetch("/api/auth/vc-init", { method: "POST" });
      if (!res.ok) {
        setError("Could not start VC verification. Please try again.");
        setStep("idle");
        setLoading(false);
        return;
      }
      const json = await res.json();
      const sessionId: string = json?.data?.session_id;
      const qrUrl: string = json?.data?.qr_url;

      if (!sessionId || !qrUrl) {
        setError("Invalid response from server. Please try again.");
        setStep("idle");
        setLoading(false);
        return;
      }

      setVcSession({ sessionId, qrUrl });
      setLoading(false);

      // Clear previous timers
      if (pollingRef.current) clearInterval(pollingRef.current);
      if (qrTimerRef.current) clearTimeout(qrTimerRef.current);

      // Start polling
      pollingRef.current = setInterval(async () => {
        try {
          const statusRes = await fetch(`/api/auth/vc-status/${sessionId}`);
          if (!statusRes.ok) {
            const errData = await statusRes.json().catch(() => null);
            const msg =
              errData?.message ??
              "Verification failed. No Keasy account is linked to this credential.";
            setError(msg);
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
            setStep("verifying");
            // Brief delay to show "Verifying..." step before showing "Authenticated"
            setTimeout(() => {
              setStep("done");
              // Brief delay to show "Authenticated" step before redirect
              setTimeout(() => router.push("/"), 1000);
            }, 800);
          } else if (status === "expired") {
            // Session expired — auto-refresh
            if (pollingRef.current) clearInterval(pollingRef.current);
            setQrExpired(true);
            initSession();
          }
        } catch {
          // Network error — keep polling
        }
      }, POLL_INTERVAL_MS);

      // QR timeout auto-refresh
      qrTimerRef.current = setTimeout(() => {
        if (pollingRef.current) clearInterval(pollingRef.current);
        setQrExpired(true);
        initSession();
      }, QR_TIMEOUT_MS);
    } catch {
      setError("Could not start VC verification. Please try again.");
      setStep("idle");
      setLoading(false);
    }
  }

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
      if (qrTimerRef.current) clearTimeout(qrTimerRef.current);
    };
  }, []);

  const steps: { label: string; key: Step | "verifying" }[] = [
    { label: "Waiting for scan", key: "scan" },
    { label: "Verifying...", key: "verifying" },
    { label: "Authenticated", key: "done" },
  ];

  function getStepStatus(stepKey: string) {
    if (step === "idle") return "pending";
    const order: string[] = ["scan", "verifying", "done"];
    const currentIdx = order.indexOf(step);
    const stepIdx = order.indexOf(stepKey);
    if (stepIdx < currentIdx) return "complete";
    if (stepIdx === currentIdx) return "active";
    return "pending";
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm flex flex-col gap-6">
        <Link
          href="/login"
          className="text-sm text-muted-foreground hover:text-primary inline-flex items-center gap-1"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to email login
        </Link>

        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-bold tracking-tight">
            Verifiable Credentials
          </h1>
          <p className="text-sm text-muted-foreground">
            Sign in using your organization&apos;s Gaia-X credentials
          </p>
        </div>

        {step === "idle" && (
          <div className="flex flex-col gap-4">
            <Button onClick={initSession} disabled={loading} className="w-full">
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Initializing...
                </>
              ) : (
                "I have my own credentials"
              )}
            </Button>
            <p className="text-center text-sm text-muted-foreground">
              Don&apos;t have credentials?{" "}
              <Link
                href="/compliance/wizard"
                className="text-primary underline-offset-4 hover:underline"
              >
                Get Gaia-X credentials
              </Link>
            </p>
          </div>
        )}

        {step !== "idle" && vcSession && (
          <div className="flex flex-col gap-4 items-center">
            {qrExpired && (
              <p className="text-sm text-muted-foreground text-center">
                QR expired, generating new code...
              </p>
            )}

            <div className="border rounded-lg p-4 bg-white">
              <QRCode value={vcSession.qrUrl} size={256} level="M" />
            </div>

            <p className="text-sm text-muted-foreground text-center">
              Scan with your wallet app
            </p>

            {/* Step indicator */}
            <div className="flex items-center gap-2 w-full">
              {steps.map((s, idx) => {
                const status = getStepStatus(s.key);
                return (
                  <div key={s.key} className="flex items-center flex-1">
                    <div className="flex flex-col items-center gap-1 flex-1">
                      <div
                        className={[
                          "h-3 w-3 rounded-full transition-colors",
                          status === "complete"
                            ? "bg-green-500"
                            : status === "active"
                              ? "bg-primary"
                              : "bg-muted-foreground/30",
                        ].join(" ")}
                      />
                      <span
                        className={[
                          "text-xs text-center leading-tight",
                          status === "active"
                            ? "text-foreground font-medium"
                            : "text-muted-foreground",
                        ].join(" ")}
                      >
                        {s.label}
                      </span>
                    </div>
                    {idx < steps.length - 1 && (
                      <div className="h-px flex-1 bg-border mb-4" />
                    )}
                  </div>
                );
              })}
            </div>

            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                if (pollingRef.current) clearInterval(pollingRef.current);
                if (qrTimerRef.current) clearTimeout(qrTimerRef.current);
                setStep("idle");
                setVcSession(null);
                setError(null);
              }}
              className="text-muted-foreground"
            >
              Cancel
            </Button>
          </div>
        )}

        {error && (
          <p className="text-sm text-destructive text-center">{error}</p>
        )}

        {step === "idle" && !loading && (
          <p className="text-center text-sm text-muted-foreground">
            Already have an account?{" "}
            <Link
              href="/login"
              className="text-primary underline-offset-4 hover:underline"
            >
              Log in with email
            </Link>
          </p>
        )}
      </div>
    </div>
  );
}
