"use client";

import { QueryErrorResetBoundary } from "@tanstack/react-query";
import { unstable_rethrow } from "next/navigation";
import { Component, Suspense, useSyncExternalStore, type ReactNode } from "react";

import { ProblemView } from "@/components/problem-view";
import { useDelayedLoading } from "@/lib/ui/use-delayed-loading";

/**
 * A failure where the data would have been, a resource that is not there included: `graph/not-found`
 * is shown by its code like any other, because Next's not-found page cannot say which resource or
 * why. Next's own control flow (a redirect, a `notFound()` thrown below) passes through untouched.
 */
export function Failed({ error, retry, className }: { error: unknown; retry: () => void; className?: string }) {
  unstable_rethrow(error);
  return <ProblemView className={className} onRetry={retry} error={error} />;
}

interface CatchProps {
  reset: () => void;
  className?: string;
  frame?: (failure: ReactNode) => ReactNode;
  children: ReactNode;
}

class Catch extends Component<CatchProps, { failed: boolean; error: unknown }> {
  state = { failed: false, error: undefined as unknown };

  static getDerivedStateFromError(error: unknown) {
    return { failed: true, error };
  }

  private retry = () => {
    this.props.reset();
    this.setState({ failed: false, error: undefined });
  };

  render() {
    if (!this.state.failed) return this.props.children;
    const failure = <Failed className={this.props.className} error={this.state.error} retry={this.retry} />;
    return this.props.frame ? this.props.frame(failure) : failure;
  }
}

/** Loading, drawn only once it has lasted long enough to be seen, so a fast answer does not flash. */
export function Loading({ children }: { children: ReactNode }) {
  return useDelayedLoading(true) ? children : null;
}

const never = () => () => {};

/**
 * Where a part of a page that reads data may fail on its own: TanStack Query's App Router pattern —
 * a `QueryErrorResetBoundary`, an error boundary that renders the failure with {@link ProblemView},
 * and a `Suspense` with `fallback` while it loads. Retry resets the failed queries and renders again.
 *
 * Its children render only in the browser. Every query reaches the API through the BFF with the
 * session cookie, which a server render does not have, so on the server the fallback is drawn —
 * what the page drew while loading before `useSuspenseQuery` — and the queries start on hydration.
 */
export function Boundary({
  fallback = null,
  className,
  frame,
  children,
}: {
  fallback?: ReactNode;
  className?: string;
  /** What the failure is drawn inside, where the part it replaces owned a landmark (`<main>`). */
  frame?: (failure: ReactNode) => ReactNode;
  children: ReactNode;
}) {
  const browser = useSyncExternalStore(never, () => true, () => false);
  return (
    <QueryErrorResetBoundary>
      {({ reset }) => (
        <Catch className={className} frame={frame} reset={reset}>
          <Suspense fallback={fallback}>{browser ? children : fallback}</Suspense>
        </Catch>
      )}
    </QueryErrorResetBoundary>
  );
}
