import { useCallback, useState } from "react";
import { toastError } from "@/lib/toast-error";

export function useMutation<T = void>(fn: (input: T) => Promise<void>) {
  const [pending, setPending] = useState(false);

  const mutate = useCallback(
    async (input: T) => {
      setPending(true);
      try {
        await fn(input);
      } catch (err) {
        toastError(err instanceof Error ? err.message : "Operation failed");
      } finally {
        setPending(false);
      }
    },
    [fn],
  );

  return { mutate, pending };
}
