"use client";

import { useCallback, useRef, useState } from "react";

interface UseLLMStreamOptions<T> {
  streamFn: () => AsyncGenerator<{ event: string; data: string }>;
  onComplete: (result: T) => void;
  onError?: (error: { code: string; message: string }) => void;
  onEvent?: (event: string, data: string) => void;
}

interface UseLLMStreamReturn<T> {
  start: () => void;
  abort: () => void;
  streamText: string;
  loading: boolean;
  error: { code: string; message: string } | null;
  result: T | null;
}

/**
 * Shared hook for consuming LLM SSE streams with RAF-batched delta updates.
 *
 * Callbacks are stored in refs to avoid stale closures — callers don't need
 * to wrap them in useCallback.
 */
export function useLLMStream<T>({
  streamFn,
  onComplete,
  onError,
  onEvent,
}: UseLLMStreamOptions<T>): UseLLMStreamReturn<T> {
  const [streamText, setStreamText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [result, setResult] = useState<T | null>(null);

  // Store callbacks in refs to always use the latest version
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;
  const streamFnRef = useRef(streamFn);
  streamFnRef.current = streamFn;

  const accRef = useRef("");
  const rafRef = useRef(false);
  const abortRef = useRef(false);

  const abort = useCallback(() => {
    abortRef.current = true;
  }, []);

  const start = useCallback(() => {
    accRef.current = "";
    rafRef.current = false;
    abortRef.current = false;
    setStreamText("");
    setError(null);
    setResult(null);
    setLoading(true);

    (async () => {
      try {
        for await (const { event, data } of streamFnRef.current()) {
          if (abortRef.current) break;

          if (event === "delta") {
            accRef.current += data;
            if (!rafRef.current) {
              rafRef.current = true;
              requestAnimationFrame(() => {
                rafRef.current = false;
                if (!abortRef.current) {
                  setStreamText(accRef.current);
                }
              });
            }
          } else if (event === "complete") {
            const parsed = JSON.parse(data) as T;
            setResult(parsed);
            onCompleteRef.current(parsed);
          } else if (event === "error") {
            const err = JSON.parse(data) as {
              code: string;
              message: string;
            };
            setError(err);
            onErrorRef.current?.(err);
          } else {
            onEventRef.current?.(event, data);
          }
        }
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : "Stream failed";
        const errorObj = { code: "stream_error", message: msg };
        setError(errorObj);
        onErrorRef.current?.(errorObj);
      } finally {
        // Flush any pending RAF delta
        setStreamText(accRef.current);
        setLoading(false);
      }
    })();
  }, []); // stable — reads everything from refs

  return { start, abort, streamText, loading, error, result };
}
