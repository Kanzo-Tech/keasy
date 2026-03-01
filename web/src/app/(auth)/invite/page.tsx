"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { fetchAuthMe, fetchInviteInfo } from "@/lib/api";


function InviteForm() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const [email, setEmail] = useState<string | null>(null);
  // If no token, start with error set and loading=false to skip the effect
  const [loading, setLoading] = useState(!!token);
  const [redirecting, setRedirecting] = useState(false);
  const [error, setError] = useState<string | null>(
    token ? null : "No invite token provided."
  );

  useEffect(() => {
    if (!token) return;

    (async () => {
      try {
        // Check if user is already logged in
        await fetchAuthMe();
        // Already logged in -- redirect to OIDC start with invite token
        // The backend will auto-accept the invite after callback
        setRedirecting(true);
        window.location.href = `/v1/auth/oidc-start?invite_token=${encodeURIComponent(token)}`;
        return;
      } catch {
        // Not logged in -- validate the invite token
      }

      try {
        const data = await fetchInviteInfo(token);
        if (data?.email) {
          setEmail(data.email);
        } else {
          setError(
            "This invite link is invalid or has expired. Please contact the person who invited you."
          );
        }
      } catch {
        setError(
          "This invite link is invalid or has expired. Please contact the person who invited you."
        );
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  function handleAcceptInvite() {
    setRedirecting(true);
    // Redirect to OIDC with prompt=create for new user registration
    // and invite_token to auto-accept after callback
    window.location.href = `/v1/auth/oidc-start?invite_token=${encodeURIComponent(token)}&prompt=create`;
  }

  if (loading || redirecting) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Invalid Invite</CardTitle>
          <CardDescription>{error}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" asChild className="w-full">
            <a href="/v1/auth/oidc-start">Sign in</a>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>You&apos;ve been invited</CardTitle>
        <CardDescription>
          An invitation has been sent to <strong>{email}</strong>. Continue to
          create your account or sign in.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Button onClick={handleAcceptInvite} disabled={redirecting} className="w-full">
          {redirecting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            "Continue"
          )}
        </Button>
        <Button variant="outline" asChild className="w-full">
          <a href="/v1/auth/oidc-start">Already have an account? Sign in</a>
        </Button>
      </CardContent>
    </Card>
  );
}

export default function InvitePage() {
  return (
    <div className="flex items-center justify-center min-h-full">
      <Suspense fallback={null}>
        <InviteForm />
      </Suspense>
    </div>
  );
}
