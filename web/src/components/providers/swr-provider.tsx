"use client";

import { useRef } from "react";
import { SWRConfig } from "swr";

export function SWRProvider({ children }: { children: React.ReactNode }) {
  const redirected = useRef(false);

  return (
    <SWRConfig
      value={{
        dedupingInterval: 2000,
        onError: (error) => {
          if (!redirected.current) {
            if (
              error?.code === "auth/session_required" ||
              error?.code === "auth/session_expired"
            ) {
              redirected.current = true;
              window.location.href = "/v1/auth/oidc-start";
            } else if (error?.code === "rbac/no_membership") {
              redirected.current = true;
              window.location.href = "/";
            }
          }
        },
      }}
    >
      {children}
    </SWRConfig>
  );
}
