import assert from "node:assert/strict";
import { request } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { close, createWorkerHealthServer, listen } from "./health.js";

function httpRequest(
  port: number,
  method: string,
  path: string,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request(
      { host: "127.0.0.1", port, method, path },
      (res) => {
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
      },
    );
    req.on("error", reject);
    req.end();
  });
}

test("worker health is live and is not a Mini App or Telegram API", async () => {
  const server = createWorkerHealthServer();
  await listen(server, "127.0.0.1", 0);
  const address = server.address() as AddressInfo;
  try {
    const live = await httpRequest(address.port, "GET", "/health/live");
    const ready = await httpRequest(address.port, "GET", "/health/ready");
    assert.equal(live.status, 200);
    assert.deepEqual(JSON.parse(live.body), {
      status: "live",
      process: "worker",
    });
    assert.equal(ready.status, 503);
    assert.equal(JSON.parse(ready.body).status, "not_ready");

    const bootstrap = await httpRequest(address.port, "GET", "/bootstrap");
    assert.equal(bootstrap.status, 404);

    const auth = await httpRequest(address.port, "POST", "/auth/telegram");
    assert.equal(auth.status, 404);

    const telegram = await httpRequest(address.port, "POST", "/telegram/webhook");
    assert.equal(telegram.status, 404);
  } finally {
    await close(server);
  }
});
