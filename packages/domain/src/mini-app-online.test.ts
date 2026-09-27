import { sessions } from "@giftbot/db/schema";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import type { DomainHarness } from "./harness.js";
import { startDomainHarness } from "./harness.js";
import {
  MINI_APP_ONLINE_WINDOW_MS,
  countMiniAppOnline,
  formatMiniAppOnlineMessage,
} from "./mini-app-online.js";
import { provisionUser } from "./user.js";

let harness: DomainHarness;

before(async () => {
  harness = await startDomainHarness();
});

after(async () => {
  await harness.stop();
});

test("formatMiniAppOnlineMessage reports the live count", () => {
  assert.match(formatMiniAppOnlineMessage(3), /Онлайн в приложении: 3/);
});

test("countMiniAppOnline uses lastUsedAt within the window only", async () => {
  const user = await provisionUser(harness.db);
  const now = new Date();
  await harness.db.insert(sessions).values({
    userId: user.userId,
    tokenHash: `online-${randomUUID()}`,
    expiresAt: new Date(now.getTime() + 60_000),
    lastUsedAt: new Date(now.getTime() - 60_000),
  });
  assert.equal(await countMiniAppOnline(harness.db, now), 1);

  const stale = await provisionUser(harness.db);
  await harness.db.insert(sessions).values({
    userId: stale.userId,
    tokenHash: `stale-${randomUUID()}`,
    expiresAt: new Date(now.getTime() + 60_000),
    lastUsedAt: new Date(now.getTime() - MINI_APP_ONLINE_WINDOW_MS - 1_000),
  });
  assert.equal(await countMiniAppOnline(harness.db, now), 1);

  const untouched = await provisionUser(harness.db);
  await harness.db.insert(sessions).values({
    userId: untouched.userId,
    tokenHash: `untouched-${randomUUID()}`,
    expiresAt: new Date(now.getTime() + 60_000),
  });
  assert.equal(await countMiniAppOnline(harness.db, now), 1);
});
