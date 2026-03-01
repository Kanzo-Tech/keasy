"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { mutate } from "swr";
import { Loader2 } from "lucide-react";
import { fetchWorkspaces } from "@/lib/api";
import type { Workspace } from "@/lib/types";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";

// Deterministic color from client_id string (hash-based hue)
function clientIdToColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) & 0xffffff;
  }
  const hue = hash % 360;
  return `hsl(${hue}, 65%, 50%)`;
}

export default function WorkspacesPage() {
  const router = useRouter();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState<string | null>(null);

  useEffect(() => {
    fetchWorkspaces()
      .then((data) => {
        const ws: Workspace[] = data?.workspaces ?? [];
        if (ws.length <= 1) {
          // Auto-skip for single dataspace — redirect straight to dashboard
          router.replace("/");
          return;
        }
        setWorkspaces(ws);
        setLoading(false);
      })
      .catch(() => {
        window.location.replace("/v1/auth/oidc-start");
      });
  }, [router]);

  const [switchTarget, setSwitchTarget] = useState<string | null>(null);

  useEffect(() => {
    if (switchTarget === null) return;
    // Navigate to destination instance's OIDC start — Keycloak SSO
    // session handles transparent re-auth without credentials
    window.location.assign(switchTarget);
  }, [switchTarget]);

  async function handleSelect(ws: Workspace) {
    setSwitching(ws.name);
    // Clear all SWR cache before navigating to prevent stale data
    await mutate(() => true, undefined, { revalidate: false });
    setSwitchTarget(`${ws.url}/v1/auth/oidc-start`);
  }

  if (loading || switching) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            {switching
              ? `Switching to ${switching}...`
              : "Loading workspaces..."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-8">
      <div className="w-full max-w-2xl space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-bold tracking-tight">
            Choose a workspace
          </h1>
          <p className="text-sm text-muted-foreground">
            Select the dataspace you want to work in
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {workspaces.map((ws) => (
            <Button
              key={ws.client_id}
              variant="ghost"
              onClick={() => handleSelect(ws)}
              className="h-auto w-full p-0 text-left"
            >
              <Card className="hover:border-primary transition-colors cursor-pointer h-full w-full">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <span
                      className="inline-block h-3 w-3 rounded-full shrink-0"
                      style={{ backgroundColor: clientIdToColor(ws.client_id) }}
                    />
                    {ws.name}
                  </CardTitle>
                  <CardDescription className="text-xs truncate">
                    {ws.url}
                  </CardDescription>
                </CardHeader>
              </Card>
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}
