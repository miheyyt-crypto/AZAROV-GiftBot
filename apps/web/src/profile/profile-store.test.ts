import assert from "node:assert/strict";
import { test } from "node:test";
import {
  loadSharedProfile,
  patchCachedProfileBalance,
  readCachedProfile,
  resetProfileStoreForTests,
  seedProfileFromBootstrap,
} from "./profile-store.js";
import { EMPTY_PROFILE_SUMMARY } from "./types.js";
import type { BootstrapPayload } from "../types.js";

const bootstrap: BootstrapPayload = {
  user: { publicId: "u1", displayName: "Zemiks" },
  wallet: { balanceMinor: "1500", currencyCode: "INTERNAL" },
  session: { expiresAt: "2099-01-01T00:00:00.000Z" },
  flags: { kickLinked: false, isSuperAdmin: false },
  counters: { referralsAttributed: 0 },
  referralCode: "abc",
  configVersion: "0",
};

test("bootstrap seed is served without GET /profile", async () => {
  resetProfileStoreForTests();
  seedProfileFromBootstrap("tok", bootstrap);
  const cached = readCachedProfile("tok");
  assert.equal(cached?.user.displayName, "Zemiks");
  const loaded = await loadSharedProfile("tok");
  assert.equal(loaded.user.displayName, "Zemiks");
  assert.equal(loaded.balances.azc, "1500");
});

test("force refresh bypasses bootstrap freshness and hits GET /profile", async () => {
  resetProfileStoreForTests();
  seedProfileFromBootstrap("tok", bootstrap);
  const originalFetch = globalThis.fetch;
  let hits = 0;
  globalThis.fetch = (async () => {
    hits += 1;
    return new Response(
      JSON.stringify({
        ...EMPTY_PROFILE_SUMMARY,
        user: {
          ...EMPTY_PROFILE_SUMMARY.user,
          displayName: "Remote",
        },
        level: { ...EMPTY_PROFILE_SUMMARY.level, current: 3 },
        activity: { kickChatMessages: "57" },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;
  try {
    const withoutForce = await loadSharedProfile("tok");
    assert.equal(withoutForce.user.displayName, "Zemiks");
    assert.equal(hits, 0);
    const forced = await loadSharedProfile("tok", { force: true });
    assert.equal(hits, 1);
    assert.equal(forced.user.displayName, "Remote");
    assert.equal(forced.level.current, 3);
    assert.equal(forced.activity.kickChatMessages, "57");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("mutation patches cached AZC without waiting for GET /profile", () => {
  resetProfileStoreForTests();
  seedProfileFromBootstrap("tok", bootstrap);
  patchCachedProfileBalance("900");
  assert.equal(readCachedProfile("tok")?.balances.azc, "900");
});
