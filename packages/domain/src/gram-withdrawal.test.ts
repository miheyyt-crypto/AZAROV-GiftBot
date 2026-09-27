import { auditLogs, gramBalances, notifications } from "@giftbot/db/schema";
import { eq } from "drizzle-orm";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import {
  GramBalanceNotFoundError,
  GramInvalidTelegramUsernameError,
  GramWithdrawalAlreadyActiveError,
  GramWithdrawalMinimumError,
  InvalidTransitionError,
} from "./errors.js";
import {
  GRAM_MIN_WITHDRAWAL_MINOR,
  GRAM_MINOR_PER_UNIT,
  formatGramMinor,
  gramAvailableMinor,
} from "./gram.js";
import {
  createGramWithdrawal,
  fulfillGramWithdrawal,
  listUserGramWithdrawals,
  markGramWithdrawalProcessing,
  parseTelegramUsername,
  rejectGramWithdrawal,
} from "./gram-withdrawal.js";
import type { DomainHarness } from "./harness.js";
import { startDomainHarness } from "./harness.js";
import { asBigInt } from "./money.js";
import { provisionUser } from "./user.js";

let harness: DomainHarness;

before(async () => {
  harness = await startDomainHarness();
});

after(async () => {
  await harness.stop();
});

async function seedGram(userId: string, amountMinor: bigint, reservedMinor = 0n) {
  await harness.db.insert(gramBalances).values({
    userId,
    amountMinor,
    reservedMinor,
  });
}

async function readGram(userId: string) {
  const rows = await harness.db
    .select()
    .from(gramBalances)
    .where(eq(gramBalances.userId, userId))
    .limit(1);
  const row = rows[0];
  assert.ok(row);
  const amountMinor = asBigInt(row.amountMinor);
  const reservedMinor = asBigInt(row.reservedMinor);
  assert.ok(reservedMinor >= 0n);
  assert.ok(amountMinor >= 0n);
  assert.ok(reservedMinor <= amountMinor);
  return {
    amountMinor,
    reservedMinor,
    availableMinor: gramAvailableMinor(amountMinor, reservedMinor),
  };
}

test("telegram username is trimmed and stored without @", () => {
  assert.equal(parseTelegramUsername(" @User_Name "), "User_Name");
  assert.equal(parseTelegramUsername("user_name"), "user_name");
  assert.throws(() => parseTelegramUsername(""), GramInvalidTelegramUsernameError);
  assert.throws(() => parseTelegramUsername("   "), GramInvalidTelegramUsernameError);
  assert.throws(
    () => parseTelegramUsername("https://t.me/user_name"),
    GramInvalidTelegramUsernameError,
  );
  assert.throws(
    () => parseTelegramUsername("t.me/user_name"),
    GramInvalidTelegramUsernameError,
  );
  assert.throws(() => parseTelegramUsername("ab"), GramInvalidTelegramUsernameError);
});

test("create reserves the full available balance at the 20 Gram minimum", async () => {
  const user = await provisionUser(harness.db);
  await seedGram(user.userId, 23_450_000_000n);
  const created = await createGramWithdrawal(harness.db, {
    userId: user.userId,
    telegramUsername: "@gift_user",
    idempotencyKey: `gram.create:${user.userId}:full`,
  });
  assert.equal(created.replayed, false);
  assert.equal(created.withdrawal.amountGram, "23.45");
  assert.equal(created.withdrawal.telegramUsername, "gift_user");
  assert.equal(created.withdrawal.status, "pending");
  const after = await readGram(user.userId);
  assert.equal(after.amountMinor, 23_450_000_000n);
  assert.equal(after.reservedMinor, 23_450_000_000n);
  assert.equal(after.availableMinor, 0n);

  const notes = await harness.db
    .select()
    .from(notifications)
    .where(eq(notifications.userId, user.userId));
  assert.equal(notes.length, 1);
  assert.equal(notes[0]?.title, "Заявка на вывод Gram создана");
  assert.equal(notes[0]?.body, "Зарезервировано 23.45 Gram");
  assert.equal(notes[0]?.channel, "inbox");
});

test("exactly 20 Gram can withdraw and 19.999999999 cannot", async () => {
  const okUser = await provisionUser(harness.db);
  await seedGram(okUser.userId, GRAM_MIN_WITHDRAWAL_MINOR);
  const created = await createGramWithdrawal(harness.db, {
    userId: okUser.userId,
    telegramUsername: "okuser",
    idempotencyKey: `gram.create:${okUser.userId}:min`,
  });
  assert.equal(created.withdrawal.amountGram, "20");

  const lowUser = await provisionUser(harness.db);
  await seedGram(lowUser.userId, GRAM_MIN_WITHDRAWAL_MINOR - 1n);
  await assert.rejects(
    () =>
      createGramWithdrawal(harness.db, {
        userId: lowUser.userId,
        telegramUsername: "lowuser",
        idempotencyKey: `gram.create:${lowUser.userId}:low`,
      }),
    GramWithdrawalMinimumError,
  );
  const still = await readGram(lowUser.userId);
  assert.equal(still.reservedMinor, 0n);
});

test("missing gram balance cannot create a withdrawal", async () => {
  const user = await provisionUser(harness.db);
  await assert.rejects(
    () =>
      createGramWithdrawal(harness.db, {
        userId: user.userId,
        telegramUsername: "nobluser",
        idempotencyKey: `gram.create:${user.userId}:missing`,
      }),
    GramBalanceNotFoundError,
  );
});

test("an active withdrawal blocks a second request and same key replays", async () => {
  const user = await provisionUser(harness.db);
  await seedGram(user.userId, 25n * GRAM_MINOR_PER_UNIT);
  const first = await createGramWithdrawal(harness.db, {
    userId: user.userId,
    telegramUsername: "firstuser",
    idempotencyKey: `gram.create:${user.userId}:active`,
  });
  const replay = await createGramWithdrawal(harness.db, {
    userId: user.userId,
    telegramUsername: "firstuser",
    idempotencyKey: `gram.create:${user.userId}:active`,
  });
  assert.equal(replay.replayed, true);
  assert.equal(replay.withdrawal.id, first.withdrawal.id);
  await assert.rejects(
    () =>
      createGramWithdrawal(harness.db, {
        userId: user.userId,
        telegramUsername: "seconduser",
        idempotencyKey: `gram.create:${user.userId}:active-b`,
      }),
    GramWithdrawalAlreadyActiveError,
  );
  const after = await readGram(user.userId);
  assert.equal(after.reservedMinor, 25n * GRAM_MINOR_PER_UNIT);
});

test("reject restores availability and fulfill deducts total and reserved", async () => {
  const admin = await provisionUser(harness.db);
  const rejectedUser = await provisionUser(harness.db);
  await seedGram(rejectedUser.userId, 21n * GRAM_MINOR_PER_UNIT);
  const rejected = await createGramWithdrawal(harness.db, {
    userId: rejectedUser.userId,
    telegramUsername: "rejuser",
    idempotencyKey: `gram.create:${rejectedUser.userId}:rej`,
  });
  await rejectGramWithdrawal(harness.db, {
    withdrawalId: rejected.withdrawal.id,
    adminUserId: admin.userId,
    reason: "недостаточно данных",
    idempotencyKey: `gram.reject:${rejected.withdrawal.id}`,
  });
  const restored = await readGram(rejectedUser.userId);
  assert.equal(restored.amountMinor, 21n * GRAM_MINOR_PER_UNIT);
  assert.equal(restored.reservedMinor, 0n);
  assert.equal(restored.availableMinor, 21n * GRAM_MINOR_PER_UNIT);

  const fulfilledUser = await provisionUser(harness.db);
  await seedGram(fulfilledUser.userId, 22n * GRAM_MINOR_PER_UNIT);
  const pending = await createGramWithdrawal(harness.db, {
    userId: fulfilledUser.userId,
    telegramUsername: "fuluser",
    idempotencyKey: `gram.create:${fulfilledUser.userId}:ful`,
  });
  await markGramWithdrawalProcessing(harness.db, {
    withdrawalId: pending.withdrawal.id,
    adminUserId: admin.userId,
    idempotencyKey: `gram.process:${pending.withdrawal.id}`,
  });
  const unchanged = await readGram(fulfilledUser.userId);
  assert.equal(unchanged.amountMinor, 22n * GRAM_MINOR_PER_UNIT);
  assert.equal(unchanged.reservedMinor, 22n * GRAM_MINOR_PER_UNIT);
  await fulfillGramWithdrawal(harness.db, {
    withdrawalId: pending.withdrawal.id,
    adminUserId: admin.userId,
    idempotencyKey: `gram.fulfill:${pending.withdrawal.id}`,
  });
  const deducted = await readGram(fulfilledUser.userId);
  assert.equal(deducted.amountMinor, 0n);
  assert.equal(deducted.reservedMinor, 0n);

  const notes = await harness.db
    .select()
    .from(notifications)
    .where(eq(notifications.userId, fulfilledUser.userId));
  assert.ok(notes.some((row) => row.title === "Вывод Gram выполнен"));
  const audits = await harness.db
    .select()
    .from(auditLogs)
    .where(eq(auditLogs.targetId, pending.withdrawal.id));
  assert.ok(audits.some((row) => row.action === "gram_withdrawal.processing"));
  assert.ok(audits.some((row) => row.action === "gram_withdrawal.fulfilled"));
});

test("terminal withdrawals are immutable", async () => {
  const admin = await provisionUser(harness.db);
  const user = await provisionUser(harness.db);
  await seedGram(user.userId, 20n * GRAM_MINOR_PER_UNIT);
  const created = await createGramWithdrawal(harness.db, {
    userId: user.userId,
    telegramUsername: "termuser",
    idempotencyKey: `gram.create:${user.userId}:term`,
  });
  await fulfillGramWithdrawal(harness.db, {
    withdrawalId: created.withdrawal.id,
    adminUserId: admin.userId,
    idempotencyKey: `gram.fulfill:${created.withdrawal.id}:a`,
  });
  await assert.rejects(
    () =>
      rejectGramWithdrawal(harness.db, {
        withdrawalId: created.withdrawal.id,
        adminUserId: admin.userId,
        reason: "too late",
        idempotencyKey: `gram.reject:${created.withdrawal.id}:late`,
      }),
    InvalidTransitionError,
  );
  await assert.rejects(
    () =>
      markGramWithdrawalProcessing(harness.db, {
        withdrawalId: created.withdrawal.id,
        adminUserId: admin.userId,
        idempotencyKey: `gram.process:${created.withdrawal.id}:late`,
      }),
    InvalidTransitionError,
  );
});

test("repeated fulfill with a different key cannot double deduct", async () => {
  const admin = await provisionUser(harness.db);
  const user = await provisionUser(harness.db);
  await seedGram(user.userId, 24n * GRAM_MINOR_PER_UNIT);
  const created = await createGramWithdrawal(harness.db, {
    userId: user.userId,
    telegramUsername: "repful",
    idempotencyKey: `gram.create:${user.userId}:repful`,
  });
  const first = await fulfillGramWithdrawal(harness.db, {
    withdrawalId: created.withdrawal.id,
    adminUserId: admin.userId,
    idempotencyKey: `gram.fulfill:${created.withdrawal.id}:1`,
  });
  const second = await fulfillGramWithdrawal(harness.db, {
    withdrawalId: created.withdrawal.id,
    adminUserId: admin.userId,
    idempotencyKey: `gram.fulfill:${created.withdrawal.id}:2`,
  });
  assert.equal(first.replayed, false);
  assert.equal(second.replayed, true);
  const after = await readGram(user.userId);
  assert.equal(after.amountMinor, 0n);
  assert.equal(after.reservedMinor, 0n);
});

test("repeated reject cannot double release", async () => {
  const admin = await provisionUser(harness.db);
  const user = await provisionUser(harness.db);
  await seedGram(user.userId, 24n * GRAM_MINOR_PER_UNIT);
  const created = await createGramWithdrawal(harness.db, {
    userId: user.userId,
    telegramUsername: "reprej",
    idempotencyKey: `gram.create:${user.userId}:reprej`,
  });
  await rejectGramWithdrawal(harness.db, {
    withdrawalId: created.withdrawal.id,
    adminUserId: admin.userId,
    reason: "duplicate check",
    idempotencyKey: `gram.reject:${created.withdrawal.id}:1`,
  });
  const second = await rejectGramWithdrawal(harness.db, {
    withdrawalId: created.withdrawal.id,
    adminUserId: admin.userId,
    reason: "duplicate check",
    idempotencyKey: `gram.reject:${created.withdrawal.id}:2`,
  });
  assert.equal(second.replayed, true);
  const after = await readGram(user.userId);
  assert.equal(after.amountMinor, 24n * GRAM_MINOR_PER_UNIT);
  assert.equal(after.reservedMinor, 0n);
});

test("two concurrent creates against 25 Gram reserve once", async () => {
  const user = await provisionUser(harness.db);
  await seedGram(user.userId, 25n * GRAM_MINOR_PER_UNIT);
  const results = await Promise.allSettled([
    createGramWithdrawal(harness.db, {
      userId: user.userId,
      telegramUsername: "conc_a",
      idempotencyKey: `gram.create:${user.userId}:conc-a`,
    }),
    createGramWithdrawal(harness.db, {
      userId: user.userId,
      telegramUsername: "conc_b",
      idempotencyKey: `gram.create:${user.userId}:conc-b`,
    }),
  ]);
  const ok = results.filter((row) => row.status === "fulfilled");
  const failed = results.filter((row) => row.status === "rejected");
  assert.equal(ok.length, 1);
  assert.equal(failed.length, 1);
  assert.ok(
    failed[0]?.status === "rejected" &&
      failed[0].reason instanceof GramWithdrawalAlreadyActiveError,
  );
  const after = await readGram(user.userId);
  assert.equal(after.amountMinor, 25n * GRAM_MINOR_PER_UNIT);
  assert.equal(after.reservedMinor, 25n * GRAM_MINOR_PER_UNIT);
  const listed = await listUserGramWithdrawals(harness.db, { userId: user.userId });
  assert.equal(listed.items.length, 1);
  assert.equal(listed.items[0]?.amountGram, formatGramMinor(25n * GRAM_MINOR_PER_UNIT));
});

test("fulfill vs reject race allows only one terminal transition", async () => {
  const adminA = await provisionUser(harness.db);
  const adminB = await provisionUser(harness.db);
  const user = await provisionUser(harness.db);
  await seedGram(user.userId, 26n * GRAM_MINOR_PER_UNIT);
  const created = await createGramWithdrawal(harness.db, {
    userId: user.userId,
    telegramUsername: "raceuser",
    idempotencyKey: `gram.create:${user.userId}:race`,
  });
  const results = await Promise.allSettled([
    fulfillGramWithdrawal(harness.db, {
      withdrawalId: created.withdrawal.id,
      adminUserId: adminA.userId,
      idempotencyKey: `gram.fulfill:${created.withdrawal.id}:race`,
    }),
    rejectGramWithdrawal(harness.db, {
      withdrawalId: created.withdrawal.id,
      adminUserId: adminB.userId,
      reason: "race reject",
      idempotencyKey: `gram.reject:${created.withdrawal.id}:race`,
    }),
  ]);
  const ok = results.filter((row) => row.status === "fulfilled");
  const failed = results.filter((row) => row.status === "rejected");
  assert.equal(ok.length, 1);
  assert.equal(failed.length, 1);
  assert.ok(
    failed[0]?.status === "rejected" &&
      failed[0].reason instanceof InvalidTransitionError,
  );
  const winner = ok[0];
  assert.ok(winner && winner.status === "fulfilled");
  const after = await readGram(user.userId);
  if (winner.value.withdrawal.status === "fulfilled") {
    assert.equal(after.amountMinor, 0n);
    assert.equal(after.reservedMinor, 0n);
  } else {
    assert.equal(after.amountMinor, 26n * GRAM_MINOR_PER_UNIT);
    assert.equal(after.reservedMinor, 0n);
    assert.equal(after.availableMinor, 26n * GRAM_MINOR_PER_UNIT);
  }
});
