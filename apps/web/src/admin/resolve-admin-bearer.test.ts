import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveAdminBearer } from "./resolve-admin-bearer.js";
import type { KeyValueStore } from "../session.js";

function memoryStore(initial: Record<string, string> = {}): KeyValueStore {
  const data = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return data.get(key) ?? null;
    },
    setItem(key, value) {
      data.set(key, value);
    },
    removeItem(key) {
      data.delete(key);
    },
  };
}

test("preview must reuse cached admin session instead of rotating via /admin/auth", async () => {
  const store = memoryStore();
  let authCalls = 0;
  const authenticate = async () => {
    authCalls += 1;
    return {
      token: `token-${authCalls}`,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    };
  };
  const first = await resolveAdminBearer({
    store,
    initData: "query_id=1",
    authenticate,
  });
  const second = await resolveAdminBearer({
    store,
    initData: "query_id=1",
    authenticate,
  });
  assert.equal(authCalls, 1);
  assert.equal(first, "token-1");
  assert.equal(second, "token-1");
});

test("concurrent preview loads share one in-flight admin token", async () => {
  const store = memoryStore();
  let authCalls = 0;
  let release!: (value: {
    token: string;
    expiresAt: string;
  }) => void;
  const gate = new Promise<{ token: string; expiresAt: string }>((resolve) => {
    release = resolve;
  });
  const authenticate = async () => {
    authCalls += 1;
    return gate;
  };
  const pending = [
    resolveAdminBearer({ store, initData: "query_id=1", authenticate }),
    resolveAdminBearer({ store, initData: "query_id=1", authenticate }),
    resolveAdminBearer({ store, initData: "query_id=1", authenticate }),
  ];
  assert.equal(authCalls, 1);
  release({
    token: "shared-token",
    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  });
  const tokens = await Promise.all(pending);
  assert.deepEqual(tokens, ["shared-token", "shared-token", "shared-token"]);
  assert.equal(authCalls, 1);
});
