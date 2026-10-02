"use client";

import "./globals.css";

import { RouteProblem } from "@/components/route-problem";

/** A failure in the root layout itself — the session read, the providers — where no other boundary stands. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body className="flex min-h-screen items-center justify-center p-4 font-sans antialiased">
        <main className="w-full max-w-xl">
          <RouteProblem error={error} reset={reset} home={false} />
        </main>
      </body>
    </html>
  );
}
