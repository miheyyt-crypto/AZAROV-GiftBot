import { useEffect, useState } from "react";
import { parseHash } from "./routes.js";
import type { AppRoute } from "./routes.js";

export function useAppRoute(): AppRoute {
  const [route, setRoute] = useState<AppRoute>(() =>
    parseHash(window.location.hash || "#/"),
  );

  useEffect(() => {
    function sync(): void {
      setRoute(parseHash(window.location.hash || "#/"));
    }
    window.addEventListener("hashchange", sync);
    window.addEventListener("popstate", sync);
    if (!window.location.hash) {
      window.location.hash = "#/";
    } else {
      sync();
    }
    return () => {
      window.removeEventListener("hashchange", sync);
      window.removeEventListener("popstate", sync);
    };
  }, []);

  return route;
}
