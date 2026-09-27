import { telegramAccounts } from "@giftbot/db/schema";
import { eq } from "drizzle-orm";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { DomainHarness } from "./harness.js";
import { startDomainHarness } from "./harness.js";
import { identifyTelegramUser } from "./telegram-identity.js";

let harness: DomainHarness;

before(async () => {
  harness = await startDomainHarness();
});

after(async () => {
  await harness.stop();
});

test("valid photo_url is stored and invalid/missing does not wipe it", async () => {
  const identity = await identifyTelegramUser(harness.db, {
    telegramUserId: 88001n,
    firstName: "Ada",
    photoUrl: "https://cdn.telegram.org/file.jpg",
  });
  let row = (
    await harness.db
      .select()
      .from(telegramAccounts)
      .where(eq(telegramAccounts.userId, identity.userId))
  )[0];
  assert.equal(row?.photoUrl, "https://cdn.telegram.org/file.jpg");

  await identifyTelegramUser(harness.db, {
    telegramUserId: 88001n,
    firstName: "Ada",
  });
  row = (
    await harness.db
      .select()
      .from(telegramAccounts)
      .where(eq(telegramAccounts.userId, identity.userId))
  )[0];
  assert.equal(row?.photoUrl, "https://cdn.telegram.org/file.jpg");

  await identifyTelegramUser(harness.db, {
    telegramUserId: 88001n,
    firstName: "Ada",
    photoUrl: "javascript:alert(1)",
  });
  row = (
    await harness.db
      .select()
      .from(telegramAccounts)
      .where(eq(telegramAccounts.userId, identity.userId))
  )[0];
  assert.equal(row?.photoUrl, "https://cdn.telegram.org/file.jpg");

  await identifyTelegramUser(harness.db, {
    telegramUserId: 88001n,
    firstName: "Ada",
    photoUrl: "https://cdn.telegram.org/new.jpg",
  });
  row = (
    await harness.db
      .select()
      .from(telegramAccounts)
      .where(eq(telegramAccounts.userId, identity.userId))
  )[0];
  assert.equal(row?.photoUrl, "https://cdn.telegram.org/new.jpg");
});
