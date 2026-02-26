"use client";

import { useRef } from "react";
import { useRouter } from "next/navigation";
import { SWRConfig } from "swr";

export function SWRProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const redirected = useRef(false);

  return (
    <SWRConfig
      value={{
        dedupingInterval: 2000,
        onError: (error) => {
          if (
            !redirected.current &&
            (error?.code === "auth/session_required" ||
              error?.code === "auth/session_expired")
          ) {
            redirected.current = true;
            router.push("/login?reason=session_expired");
          }
        },
      }}
    >
      {children}
    </SWRConfig>
  );
}
