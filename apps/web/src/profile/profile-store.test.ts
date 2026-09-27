import assert from "node:assert/strict";
import { test } from "node:test";
import {
  loadSharedProfile,
  patchCachedProfileBalance,
  readCachedProfile,
  resetProfileStoreForTests,
  seedProfileFromBootstrap,
} from "./profile-store.js";
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

test("mutation patches cached AZC without waiting for GET /profile", () => {
  resetProfileStoreForTests();
  seedProfileFromBootstrap("tok", bootstrap);
  patchCachedProfileBalance("900");
  assert.equal(readCachedProfile("tok")?.balances.azc, "900");
});
