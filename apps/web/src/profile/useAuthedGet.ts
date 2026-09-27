import { useEffect, useState } from "react";
import { loadJson } from "../api.js";

export type QueryState<T> =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: T };

export function useAuthedGet<T>(
  token: string,
  path: string,
  parse: (value: unknown) => T,
  enabled: boolean,
  fallback: T,
  refetchOnVisible = false,
): QueryState<T> & { retry: () => void } {
  const [state, setState] = useState<QueryState<T>>(
    enabled ? { status: "loading" } : { status: "ready", data: fallback },
  );
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!enabled) {
      setState({ status: "ready", data: fallback });
      return;
    }
    let cancelled = false;
    setState({ status: "loading" });
    void loadJson(token, path, parse)
      .then((data) => {
        if (!cancelled) {
          setState({ status: "ready", data });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({
            status: "error",
            message: error instanceof Error ? error.message : "request failed",
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [token, path, parse, enabled, fallback, nonce]);

  useEffect(() => {
    if (!enabled || !refetchOnVisible) {
      return;
    }
    function onVisible(): void {
      if (document.visibilityState === "visible") {
        setNonce((value) => value + 1);
      }
    }
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [enabled, refetchOnVisible]);

  return {
    ...state,
    retry: () => setNonce((value) => value + 1),
  };
}