"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";

export default function Forbidden() {
  const [loggingOut, setLoggingOut] = useState(false);

  async function handleLogout() {
    setLoggingOut(true);
    try {
      const data = await api.auth.logout();
      if (data?.end_session_url) {
        window.location.href = data.end_session_url;
        return;
      }
    } catch {
      // Ignore — redirect regardless
    }
    window.location.href = "/v1/auth/oidc-start";
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-4 text-center">
      <p className="text-8xl font-bold tracking-tight text-muted-foreground/30">403</p>
      <h1 className="text-xl font-semibold">Access denied</h1>
      <p className="text-sm text-muted-foreground max-w-xs">
        You don&apos;t have access to this dataspace. Contact the administrator to receive an invite.
      </p>
      <Button variant="outline" size="sm" onClick={handleLogout} disabled={loggingOut}>
        {loggingOut ? "Logging out..." : "Log out"}
      </Button>
    </div>
  );
}
