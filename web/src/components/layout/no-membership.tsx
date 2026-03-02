"use client";

import { useState } from "react";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { api } from "@/lib/api";

export function NoMembership() {
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
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="max-w-md w-full">
        <CardHeader className="text-center">
          <CardTitle>No Access</CardTitle>
          <CardDescription>
            You need an invitation to access this dataspace. Please contact the
            administrator to receive an invite link.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex justify-center">
          <Button
            variant="outline"
            onClick={handleLogout}
            disabled={loggingOut}
          >
            <LogOut className="mr-2 h-4 w-4" />
            {loggingOut ? "Logging out..." : "Log out"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
