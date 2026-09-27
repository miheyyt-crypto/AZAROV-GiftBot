import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiRequestError } from "./api.js";
import { bootMiniApp, resetBootInflightForTests } from "./boot.js";
import type { KeyValueStore } from "./session.js";

function memoryStore(): KeyValueStore {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, v);
    },
    removeItem: (k) => {
      map.delete(k);
    },
  };
}

test("boot with invalid/missing initData and no dev role needs Telegram", async () => {
  resetBootInflightForTests();
  const result = await bootMiniApp(memoryStore(), () => undefined, {});
  assert.equal(result.status, "needs_telegram");
});

test("boot with ?dev=user path uses authenticateDev (mocked via fetch failure → explicit error, not Telegram gate)", async () => {
  resetBootInflightForTests();
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new TypeError("fetch failed");
  };
  try {
    const result = await bootMiniApp(memoryStore(), () => undefined, {
      devRole: "user",
    });
    assert.equal(result.status, "error");
    assert.match(result.message, /pnpm dev:local|local API|dev auth/i);
    assert.notEqual(result.status, "needs_telegram");
  } finally {
    globalThis.fetch = original;
  }
});

test("ApiRequestError 404 from /dev/auth maps to disabled message", async () => {
  resetBootInflightForTests();
  const original = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ error: "NOT_FOUND" }), { status: 404 });
  try {
    const result = await bootMiniApp(memoryStore(), () => undefined, {
      devRole: "admin",
    });
    assert.equal(result.status, "error");
    assert.match(result.message, /ALLOW_DEV_AUTH/);
  } finally {
    globalThis.fetch = original;
  }
});

test("production-style boot ignores absent Telegram without inventing privileges", async () => {
  resetBootInflightForTests();
  const result = await bootMiniApp(memoryStore(), () => undefined);
  assert.equal(result.status, "needs_telegram");
  assert.ok(!(result as { token?: string }).token);
});

// Keep type reference so ApiRequestError import stays meaningful if tree-shaken elsewhere.
void ApiRequestError;
