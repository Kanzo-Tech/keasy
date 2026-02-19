import { useCallback, useEffect, useRef, useState } from "react";

export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    let cancelled = false;
    try {
      const result = await fnRef.current();
      if (!cancelled) setData(result);
    } catch (err) {
      if (!cancelled) setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      if (!cancelled) setLoading(false);
    }
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    load().then((c) => { cleanup = c; });
    return () => cleanup?.();
  }, [load]);

  return { data, loading, error, reload: load };
}
