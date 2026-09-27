import type { IncomingMessage, ServerResponse } from "node:http";
import { metricsBody, type Metrics } from "./metrics.js";

export function liveBody(processName: string): {
  status: "live";
  process: string;
} {
  return { status: "live", process: processName };
}

export function readyBody(processName: string): {
  status: "ready";
  process: string;
} {
  return { status: "ready", process: processName };
}

export function notReadyBody(
  processName: string,
  reason = "database_unavailable",
): {
  status: "not_ready";
  process: string;
  reason: string;
} {
  return { status: "not_ready", process: processName, reason };
}

function requestPath(url: string | undefined): string {
  return (url ?? "/").split("?")[0] ?? "/";
}

function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
): void {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
  });
  res.end(JSON.stringify(body));
}

export async function writeProcessHealthResponse(
  req: IncomingMessage,
  res: ServerResponse,
  options: {
    processName: string;
    checkReady?: () => Promise<void>;
    metrics?: Metrics;
  },
): Promise<boolean> {
  if (req.method !== "GET") {
    return false;
  }
  const path = requestPath(req.url);
  if (path === "/health/live") {
    sendJson(res, 200, liveBody(options.processName));
    return true;
  }
  if (path === "/health/ready") {
    if (!options.checkReady) {
      sendJson(res, 503, notReadyBody(options.processName));
      return true;
    }
    try {
      await options.checkReady();
      sendJson(res, 200, readyBody(options.processName));
    } catch {
      sendJson(res, 503, notReadyBody(options.processName));
    }
    return true;
  }
  if (path === "/metrics" && options.metrics) {
    sendJson(res, 200, metricsBody(options.processName, options.metrics));
    return true;
  }
  return false;
}
