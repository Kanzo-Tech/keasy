"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import useSWR from "swr";

import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

function LoginContent() {
  const [loading, setLoading] = useState(false);
  const searchParams = useSearchParams();
  const authError = searchParams.get("error") === "auth_failed";
  const sessionExpired = searchParams.get("reason") === "session_expired";

  const { data: vcHealth } = useSWR("/api/auth/vc-health", fetcher, {
    refreshInterval: 30000,
    fallbackData: { data: { vc_available: false } },
  });
  const vcAvailable = vcHealth?.data?.vc_available === true;

  function handleOidcSignIn() {
    setLoading(true);
    // Full browser navigation -- spinner stays until Keycloak redirect
    window.location.href = "/api/auth/oidc-start";
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2 text-center">
        <h2 className="text-2xl font-bold tracking-tight">Welcome back</h2>
        <p className="text-sm text-muted-foreground">
          Sign in to your account to continue
        </p>
      </div>

      {(authError || sessionExpired) && (
        <Alert variant="destructive">
          <AlertDescription>
            {sessionExpired
              ? "Your session has expired. Please sign in again."
              : "Authentication failed. Please try again."}
          </AlertDescription>
        </Alert>
      )}

      <Button
        onClick={handleOidcSignIn}
        disabled={loading}
        className="w-full"
        size="lg"
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Sign in"}
      </Button>

      {vcAvailable && (
        <>
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-background px-2 text-muted-foreground">
                or
              </span>
            </div>
          </div>

          <Button variant="outline" asChild className="w-full">
            <a href="/login/vc">Sign in with Credential</a>
          </Button>
        </>
      )}
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginContent />
    </Suspense>
  );
}
