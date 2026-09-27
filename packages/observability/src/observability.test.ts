import assert from "node:assert/strict";
import { createServer } from "node:http";
import { request } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import {
  createCorrelationIds,
  createLogger,
  createMetrics,
  currentCorrelation,
  METRIC_NAMES,
  redactSecrets,
  runWithCorrelation,
  writeProcessHealthResponse,
} from "./index.js";

test("incoming request id is reused as correlation id", () => {
  const ids = createCorrelationIds({ requestId: "req-phase12" });
  assert.equal(ids.requestId, "req-phase12");
  assert.equal(ids.correlationId, "req-phase12");
});

test("AsyncLocalStorage exposes the active correlation", () => {
  const ids = createCorrelationIds({ requestId: "als-1" });
  const seen = runWithCorrelation(ids, () => currentCorrelation());
  assert.deepEqual(seen, ids);
  assert.equal(currentCorrelation(), undefined);
});

test("secrets are stripped from structured logs", () => {
  const lines: string[] = [];
  const logger = createLogger("observability", (line) => {
    lines.push(line);
  });
  runWithCorrelation(createCorrelationIds({ requestId: "log-1" }), () => {
    logger.info("auth attempt", {
      authorization: "Bearer super-secret",
      initData: "query=1",
      path: "/auth/telegram",
    });
  });
  assert.equal(lines.length, 1);
  const row = JSON.parse(lines[0] ?? "{}") as Record<string, unknown>;
  assert.equal(row.request_id, "log-1");
  assert.equal(row.authorization, "[REDACTED]");
  assert.equal(row.initData, "[REDACTED]");
  assert.equal(row.path, "/auth/telegram");
  assert.equal(JSON.stringify(row).includes("super-secret"), false);
});

test("redactSecrets walks nested objects", () => {
  const redacted = redactSecrets({
    headers: { Authorization: "secret", "x-request-id": "ok" },
    nested: { client_secret: "nope" },
  }) as Record<string, Record<string, unknown>>;
  assert.equal(redacted.headers?.Authorization, "[REDACTED]");
  assert.equal(redacted.headers?.["x-request-id"], "ok");
  assert.equal(redacted.nested?.client_secret, "[REDACTED]");
});

test("live is not ready and health writes nothing to metrics storage only", async () => {
  const metrics = createMetrics();
  metrics.increment(METRIC_NAMES.httpRequests);
  const server = createServer((req, res) => {
    void writeProcessHealthResponse(req, res, {
      processName: "worker",
      metrics,
    }).then((handled) => {
      if (!handled) {
        res.writeHead(404);
        res.end();
      }
    });
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address() as AddressInfo;
  try {
    const live = await httpGet(address.port, "/health/live");
    const ready = await httpGet(address.port, "/health/ready");
    const scraped = await httpGet(address.port, "/metrics");
    assert.equal(live.status, 200);
    assert.deepEqual(JSON.parse(live.body), { status: "live", process: "worker" });
    assert.equal(ready.status, 503);
    assert.equal(JSON.parse(ready.body).status, "not_ready");
    assert.equal(scraped.status, 200);
    assert.equal(JSON.parse(scraped.body).counters.http_requests, 1);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }
});

function httpGet(
  port: number,
  path: string,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path, method: "GET" }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => {
        chunks.push(chunk);
      });
      res.on("end", () => {
        resolve({
          status: res.statusCode ?? 0,
          body: Buffer.concat(chunks).toString("utf8"),
        });
      });
    });
    req.on("error", reject);
    req.end();
  });
}
