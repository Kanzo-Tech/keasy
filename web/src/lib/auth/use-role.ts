"use client";

import { useSession } from "@kanzo-tech/auth";

import { useBranding } from "@/lib/branding-context";

import { displayRole, holds, type Role } from "./roles";

/** The caller's role in this workspace's organization, for drawing affordances. */
export function useRole(): { organization: string; role: Role | null; holds: (role: Role) => boolean } {
  const { session } = useSession();
  const { organization } = useBranding();
  return {
    organization,
    role: displayRole(session, organization),
    holds: (role) => holds(session, organization, role),
  };
}
