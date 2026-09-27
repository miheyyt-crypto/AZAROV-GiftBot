import {
  inboundEvents,
  kickAccounts,
  kickOauthStates,
  walletTransactions,
} from "@giftbot/db/schema";
import { eq } from "drizzle-orm";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { ConflictError, NotFoundError } from "./errors.js";
import type { DomainHarness } from "./harness.js";
import { startDomainHarness } from "./harness.js";
import {
  applyKickInboundEvent,
  consumeKickOAuthState,
  createKickOAuthState,
  extractKickUserIds,
  linkKickAccount,
} from "./kick.js";
import { provisionUser } from "./user.js";
import { decryptSecret, encryptSecret, parseTokenEncryptionKey } from "./secret-crypto.js";

let harness: DomainHarness;
const key = parseTokenEncryptionKey("ab".repeat(32));

before(async () => {
  harness = await startDomainHarness();
});

after(async () => {
  await harness.stop();
});

test("oauth state is consumed once", async () => {
  const user = await provisionUser(harness.db);
  const created = await createKickOAuthState(harness.db, { userId: user.userId });
  const first = await consumeKickOAuthState(harness.db, created.state);
  assert.equal(first.userId, user.userId);
  assert.equal(first.codeVerifier, created.codeVerifier);
  await assert.rejects(
    () => consumeKickOAuthState(harness.db, created.state),
    NotFoundError,
  );
  const row = (
    await harness.db
      .select()
      .from(kickOauthStates)
      .where(eq(kickOauthStates.state, created.state))
  )[0];
  assert.ok(row?.consumedAt);
});

test("kick account link stores ciphertext and rejects another user", async () => {
  const owner = await provisionUser(harness.db);
  const other = await provisionUser(harness.db);
  const cipher = encryptSecret(key, "access-token");
  const linked = await linkKickAccount(harness.db, {
    userId: owner.userId,
    kickUserId: "kick-user-phase9-1",
    accessTokenEncrypted: cipher,
  });
  assert.equal(linked.created, true);
  const row = (
    await harness.db
      .select()
      .from(kickAccounts)
      .where(eq(kickAccounts.id, linked.id))
  )[0];
  assert.equal(row?.accessTokenEncrypted, cipher);
  assert.equal(decryptSecret(key, row?.accessTokenEncrypted ?? ""), "access-token");
  await assert.rejects(
    () =>
      linkKickAccount(harness.db, {
        userId: other.userId,
        kickUserId: "kick-user-phase9-1",
      }),
    ConflictError,
  );
});

test("inbound apply is replay-safe and is not watch-time or money", async () => {
  const user = await provisionUser(harness.db);
  await linkKickAccount(harness.db, {
    userId: user.userId,
    kickUserId: "kick-user-phase9-2",
  });
  const inserted = await harness.db
    .insert(inboundEvents)
    .values({
      provider: "kick",
      eventType: "chat.message.sent",
      externalEventId: "kick-apply-replay-1",
      idempotencyKey: "kick:kick-apply-replay-1",
      payload: {
        user_id: "kick-user-phase9-2",
        watch_seconds: 999,
      },
      signatureValid: true,
    })
    .returning({ id: inboundEvents.id });
  const eventId = inserted[0]?.id;
  assert.ok(eventId);
  const first = await applyKickInboundEvent(harness.db, eventId);
  const replay = await applyKickInboundEvent(harness.db, eventId);
  assert.equal(first.replayed, false);
  assert.equal(replay.replayed, true);
  assert.equal(first.kickAccountId, replay.kickAccountId ?? first.kickAccountId);

  const account = (
    await harness.db
      .select()
      .from(kickAccounts)
      .where(eq(kickAccounts.kickUserId, "kick-user-phase9-2"))
  )[0];
  assert.equal(account?.lastInboundEventId, eventId);
  const inbound = (
    await harness.db
      .select()
      .from(inboundEvents)
      .where(eq(inboundEvents.id, eventId))
  )[0];
  assert.equal(inbound?.processingStatus, "processed");
  const ledger = await harness.db
    .select()
    .from(walletTransactions)
    .where(eq(walletTransactions.userId, user.userId));
  assert.equal(ledger.length, 0);
  assert.equal(
    extractKickUserIds({ user: { id: "kick-user-phase9-2" } })[0],
    "kick-user-phase9-2",
  );
  assert.equal(
    extractKickUserIds({
      sender: { user_id: 129057484, username: "testuser" },
    })[0],
    "129057484",
  );
  assert.ok(
    extractKickUserIds({
      sender: { id: 129057484 },
    }).includes("129057484"),
  );
});

test("kick link stores profile avatar and rejects invalid URL", async () => {
  const owner = await provisionUser(harness.db);
  const linked = await linkKickAccount(harness.db, {
    userId: owner.userId,
    kickUserId: "kick-user-avatar-1",
    username: "kickname",
    displayName: "Kick Name",
    avatarUrl: "https://images.kick.com/ok.png",
  });
  let row = (
    await harness.db
      .select()
      .from(kickAccounts)
      .where(eq(kickAccounts.id, linked.id))
  )[0];
  assert.equal(row?.username, "kickname");
  assert.equal(row?.displayName, "Kick Name");
  assert.equal(row?.avatarUrl, "https://images.kick.com/ok.png");

  await linkKickAccount(harness.db, {
    userId: owner.userId,
    kickUserId: "kick-user-avatar-1",
    avatarUrl: "javascript:alert(1)",
  });
  row = (
    await harness.db
      .select()
      .from(kickAccounts)
      .where(eq(kickAccounts.id, linked.id))
  )[0];
  assert.equal(row?.avatarUrl, "https://images.kick.com/ok.png");
});
