import { useEffect, useState } from "react";

export function useDelayedLoading(isLoading: boolean, delayMs = 150) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!isLoading) return;
    const timer = setTimeout(() => setShow(true), delayMs);
    return () => { clearTimeout(timer); setShow(false); };
  }, [isLoading, delayMs]);
  return show;
}
