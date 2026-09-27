import {
  freeCaseOpenings,
  gramBalances,
  inventoryItems,
  notifications,
  rngDraws,
  walletTransactions,
  wallets,
} from "@giftbot/db/schema";
import { eq } from "drizzle-orm";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Clock } from "./clock.js";
import {
  FREE_CASE_CATALOG,
  FREE_CASE_COOLDOWN_MS,
  FREE_CASE_DISPLAY_TOTALS,
  FREE_CASE_TOTAL_WEIGHT,
  assertFreeCaseCatalogIntegrity,
  freeCaseCatalogTotalWeight,
  getFreeCaseStatus,
  invalidateRecentWinsCache,
  listFreeCaseHistory,
  listRecentWins,
  openFreeCase,
  setFreeCaseNextAvailableAtForTests,
} from "./free-case.js";
import {
  FreeCaseCooldownActiveError,
} from "./errors.js";
import type { DomainHarness } from "./harness.js";
import { startDomainHarness } from "./harness.js";
import { asBigInt } from "./money.js";
import { provisionUser } from "./user.js";
import { GRAM_MINOR_PER_UNIT, formatGramMinor } from "./gram.js";

let harness: DomainHarness;

before(async () => {
  harness = await startDomainHarness();
});

after(async () => {
  await harness.stop();
});

function fixedClock(at: Date): Clock {
  return { now: () => new Date(at.getTime()) };
}

test("free case catalog has exact approved odds and display separation", () => {
  assertFreeCaseCatalogIntegrity();
  assert.equal(FREE_CASE_CATALOG.length, 16);
  assert.equal(
    FREE_CASE_CATALOG.filter((i) => i.rarity === "legendary").length,
    6,
  );
  assert.equal(FREE_CASE_CATALOG.filter((i) => i.rarity === "epic").length, 4);
  assert.equal(FREE_CASE_CATALOG.filter((i) => i.rarity === "common").length, 6);
  assert.equal(freeCaseCatalogTotalWeight(), FREE_CASE_TOTAL_WEIGHT);
  assert.equal(FREE_CASE_TOTAL_WEIGHT, 600_000n);

  for (const item of FREE_CASE_CATALOG.filter((i) => i.rarity === "legendary")) {
    assert.equal(item.weight, 6n);
    assert.equal(item.realChance, "0.001");
    assert.equal(item.displayChance, "1");
  }
  for (const item of FREE_CASE_CATALOG.filter((i) => i.rarity === "epic")) {
    assert.equal(item.weight, 12n);
    assert.equal(item.realChance, "0.002");
    assert.equal(item.displayChance, "5");
  }
  for (const item of FREE_CASE_CATALOG.filter((i) => i.rarity === "common")) {
    assert.equal(item.weight, 99_986n);
    assert.equal(item.displayChance, "12.33");
  }
  assert.deepEqual(FREE_CASE_DISPLAY_TOTALS, {
    legendary: "6",
    epic: "20",
    common: "74",
  });
  // display odds must not equal real weights ratio for common
  assert.notEqual("12.33", "16.664333333333");
});

test("new user can open free case and cooldown blocks until nextAvailableAt", async () => {
  const user = await provisionUser(harness.db);
  const t0 = new Date("2026-09-14T12:00:00.000Z");
  const opened = await openFreeCase(harness.db, {
    userId: user.userId,
    idempotencyKey: `free:${user.userId}:1`,
    clock: fixedClock(t0),
  });
  assert.equal(opened.replayed, false);
  assert.equal(opened.caseCode, "free");
  assert.ok(BY_CODE_HAS(opened.result.itemCode));
  assert.equal(
    opened.nextAvailableAt,
    new Date(t0.getTime() + FREE_CASE_COOLDOWN_MS).toISOString(),
  );

  const status = await getFreeCaseStatus(harness.db, {
    userId: user.userId,
    clock: fixedClock(new Date(t0.getTime() + FREE_CASE_COOLDOWN_MS - 1000)),
  });
  assert.equal(status.available, false);
  assert.ok(status.remainingSeconds >= 1);

  await assert.rejects(
    () =>
      openFreeCase(harness.db, {
        userId: user.userId,
        idempotencyKey: `free:${user.userId}:2`,
        clock: fixedClock(new Date(t0.getTime() + FREE_CASE_COOLDOWN_MS - 1)),
      }),
    FreeCaseCooldownActiveError,
  );

  const again = await openFreeCase(harness.db, {
    userId: user.userId,
    idempotencyKey: `free:${user.userId}:3`,
    clock: fixedClock(new Date(t0.getTime() + FREE_CASE_COOLDOWN_MS)),
  });
  assert.equal(again.replayed, false);
});

function BY_CODE_HAS(code: string): boolean {
  return FREE_CASE_CATALOG.some((item) => item.itemCode === code);
}

test("same idempotency key replays without a second reward", async () => {
  const user = await provisionUser(harness.db);
  const key = `free:${user.userId}:replay`;
  const first = await openFreeCase(harness.db, {
    userId: user.userId,
    idempotencyKey: key,
    clock: fixedClock(new Date("2026-09-14T10:00:00.000Z")),
  });
  const second = await openFreeCase(harness.db, {
    userId: user.userId,
    idempotencyKey: key,
    clock: fixedClock(new Date("2026-09-14T10:00:00.000Z")),
  });
  assert.equal(second.replayed, true);
  assert.equal(second.openingId, first.openingId);
  assert.equal(second.result.itemCode, first.result.itemCode);
  const openings = await harness.db
    .select()
    .from(freeCaseOpenings)
    .where(eq(freeCaseOpenings.userId, user.userId));
  assert.equal(openings.length, 1);
});

test("azc reward credits wallet via free_case_reward", async () => {
  const user = await provisionUser(harness.db);
  const at = new Date("2026-09-14T11:00:00.000Z");
  const opened = await openFreeCase(harness.db, {
    userId: user.userId,
    idempotencyKey: `free:${user.userId}:azc`,
    clock: fixedClock(at),
    forceItemCodeForTests: "azc-100",
  });
  assert.equal(opened.result.itemCode, "azc-100");
  assert.equal(opened.result.rewardType, "azc");
  const wallet = await harness.db
    .select()
    .from(wallets)
    .where(eq(wallets.userId, user.userId))
    .limit(1);
  assert.equal(asBigInt(wallet[0]?.balanceMinor ?? 0n), 100n);
  const ledger = await harness.db
    .select()
    .from(walletTransactions)
    .where(eq(walletTransactions.userId, user.userId));
  assert.equal(ledger.filter((row) => row.type === "free_case_reward").length, 1);
});

test("gram reward credits exact minor units without float", async () => {
  const user = await provisionUser(harness.db);
  const at = new Date("2026-09-14T11:30:00.000Z");
  const opened = await openFreeCase(harness.db, {
    userId: user.userId,
    idempotencyKey: `free:${user.userId}:gram`,
    clock: fixedClock(at),
    forceItemCodeForTests: "gram-0001",
  });
  assert.equal(opened.result.itemCode, "gram-0001");
  const gram = await harness.db
    .select()
    .from(gramBalances)
    .where(eq(gramBalances.userId, user.userId))
    .limit(1);
  assert.equal(asBigInt(gram[0]?.amountMinor ?? 0n), 1_000_000n);
  assert.equal(opened.balances.gram, formatGramMinor(1_000_000n));
  const big = await openFreeCase(harness.db, {
    userId: user.userId,
    idempotencyKey: `free:${user.userId}:gram100`,
    clock: fixedClock(new Date(at.getTime() + FREE_CASE_COOLDOWN_MS)),
    forceItemCodeForTests: "gram-100",
  });
  assert.equal(big.result.itemCode, "gram-100");
  const gramAfter = await harness.db
    .select()
    .from(gramBalances)
    .where(eq(gramBalances.userId, user.userId))
    .limit(1);
  assert.equal(
    asBigInt(gramAfter[0]?.amountMinor ?? 0n),
    1_000_000n + 100n * GRAM_MINOR_PER_UNIT,
  );
});

test("external prize creates inventory item without delivery workflow", async () => {
  const user = await provisionUser(harness.db);
  const at = new Date("2026-09-14T12:30:00.000Z");
  const opened = await openFreeCase(harness.db, {
    userId: user.userId,
    idempotencyKey: `free:${user.userId}:ext`,
    clock: fixedClock(at),
    forceItemCodeForTests: "nft-diamond-ring",
  });
  assert.equal(opened.result.rewardType, "external");
  const items = await harness.db
    .select()
    .from(inventoryItems)
    .where(eq(inventoryItems.userId, user.userId));
  assert.equal(items.length, 1);
  assert.equal(items[0]?.itemType, "external_prize");
  assert.equal(items[0]?.itemCode, "nft-diamond-ring");
  assert.equal(items[0]?.source, "free_case");
  assert.equal(items[0]?.status, "available");
});

test("concurrent opens grant exactly one opening and one reward", async () => {
  const user = await provisionUser(harness.db);
  const at = new Date("2026-09-14T15:00:00.000Z");
  await setFreeCaseNextAvailableAtForTests(harness.db, user.userId, at);
  const results = await Promise.allSettled([
    openFreeCase(harness.db, {
      userId: user.userId,
      idempotencyKey: `free:${user.userId}:conc:a`,
      clock: fixedClock(at),
    }),
    openFreeCase(harness.db, {
      userId: user.userId,
      idempotencyKey: `free:${user.userId}:conc:b`,
      clock: fixedClock(at),
    }),
  ]);
  const ok = results.filter((row) => row.status === "fulfilled");
  const failed = results.filter((row) => row.status === "rejected");
  assert.equal(ok.length, 1);
  assert.equal(failed.length, 1);
  assert.ok(
    failed[0]?.status === "rejected" &&
      failed[0].reason instanceof FreeCaseCooldownActiveError,
  );
  const openings = await harness.db
    .select()
    .from(freeCaseOpenings)
    .where(eq(freeCaseOpenings.userId, user.userId));
  assert.equal(openings.length, 1);
  const inbox = await harness.db
    .select()
    .from(notifications)
    .where(eq(notifications.userId, user.userId));
  assert.equal(inbox.length, 1);
});

test("history and recent wins expose real chance not display odds", async () => {
  const user = await provisionUser(harness.db);
  const at = new Date("2026-09-14T16:00:00.000Z");
  const opened = await openFreeCase(harness.db, {
    userId: user.userId,
    idempotencyKey: `free:${user.userId}:hist`,
    clock: fixedClock(at),
  });
  const history = await listFreeCaseHistory(harness.db, { userId: user.userId });
  assert.equal(history.items.length, 1);
  assert.equal(history.items[0]?.itemCode, opened.result.itemCode);
  const recent = await listRecentWins(harness.db, { limit: 5 });
  assert.ok(recent.items.some((row) => row.id === opened.openingId));
  const win = recent.items.find((row) => row.id === opened.openingId);
  assert.equal(win?.realChance, opened.result.realChance);
  assert.notEqual(win?.realChance, opened.result.displayChance);
  assert.equal(win?.rewardLabel, opened.result.title);
  assert.ok(typeof recent.serverTime === "string");
});

test("recent wins limit is clamped", async () => {
  const capped = await listRecentWins(harness.db, { limit: 500 });
  assert.ok(capped.items.length <= 50);
  const ten = await listRecentWins(harness.db, { limit: 10 });
  assert.ok(ten.items.length <= 10);
});

test("forced gram-50 opening persists the same reward as the API result", async () => {
  const user = await provisionUser(harness.db);
  const at = new Date("2026-09-19T08:00:00.000Z");
  const opened = await openFreeCase(harness.db, {
    userId: user.userId,
    idempotencyKey: `free:${user.userId}:gram50`,
    clock: fixedClock(at),
    forceItemCodeForTests: "gram-50",
  });
  assert.equal(opened.result.itemCode, "gram-50");
  assert.equal(opened.result.rewardType, "gram");
  assert.equal(opened.result.title, "50 Gram");
  assert.equal(opened.result.imageKey, "gram-50");
  const rows = await harness.db
    .select()
    .from(freeCaseOpenings)
    .where(eq(freeCaseOpenings.id, opened.openingId))
    .limit(1);
  const persisted = rows[0];
  assert.ok(persisted);
  assert.equal(persisted.itemCode, opened.result.itemCode);
  assert.equal(persisted.rewardType, opened.result.rewardType);
  assert.equal(persisted.titleSnapshot, opened.result.title);
  assert.equal(persisted.rngDrawId, null);
  const draws = await harness.db
    .select({ id: rngDraws.id })
    .from(rngDraws)
    .where(eq(rngDraws.referenceId, opened.openingId));
  assert.equal(draws.length, 0);
  const gram = await harness.db
    .select()
    .from(gramBalances)
    .where(eq(gramBalances.userId, user.userId))
    .limit(1);
  assert.equal(asBigInt(gram[0]?.amountMinor ?? 0n), 50n * GRAM_MINOR_PER_UNIT);
  const status = await getFreeCaseStatus(harness.db, {
    userId: user.userId,
    clock: fixedClock(at),
  });
  assert.equal(status.lastOpening?.openingId, opened.openingId);
  assert.equal(status.lastOpening?.itemCode, "gram-50");
  assert.equal(status.lastOpening?.title, "50 Gram");
  invalidateRecentWinsCache();
  const recent = await listRecentWins(harness.db, { limit: 20 });
  const win = recent.items.find((row) => row.id === opened.openingId);
  assert.equal(win?.itemCode, "gram-50");
  assert.equal(win?.rewardLabel, "50 Gram");
  assert.equal(win?.title, "50 Gram");
});

test("forced azc-100 opening persists coins and is not rewritten as gram", async () => {
  const user = await provisionUser(harness.db);
  const at = new Date("2026-09-19T09:00:00.000Z");
  const opened = await openFreeCase(harness.db, {
    userId: user.userId,
    idempotencyKey: `free:${user.userId}:azc100`,
    clock: fixedClock(at),
    forceItemCodeForTests: "azc-100",
  });
  assert.equal(opened.result.itemCode, "azc-100");
  assert.equal(opened.result.rewardType, "azc");
  assert.equal(opened.result.title, "100 AZC");
  const rows = await harness.db
    .select()
    .from(freeCaseOpenings)
    .where(eq(freeCaseOpenings.id, opened.openingId))
    .limit(1);
  assert.equal(rows[0]?.itemCode, "azc-100");
  assert.equal(rows[0]?.rewardType, "azc");
  const wallet = await harness.db
    .select()
    .from(wallets)
    .where(eq(wallets.userId, user.userId))
    .limit(1);
  assert.equal(asBigInt(wallet[0]?.balanceMinor ?? 0n), 100n);
});

test("two sequential openings do not mix persisted rewards", async () => {
  const user = await provisionUser(harness.db);
  const t0 = new Date("2026-09-19T10:00:00.000Z");
  const first = await openFreeCase(harness.db, {
    userId: user.userId,
    idempotencyKey: `free:${user.userId}:seq:a`,
    clock: fixedClock(t0),
    forceItemCodeForTests: "gram-50",
  });
  const second = await openFreeCase(harness.db, {
    userId: user.userId,
    idempotencyKey: `free:${user.userId}:seq:b`,
    clock: fixedClock(new Date(t0.getTime() + FREE_CASE_COOLDOWN_MS)),
    forceItemCodeForTests: "azc-100",
  });
  assert.notEqual(first.openingId, second.openingId);
  assert.equal(first.result.itemCode, "gram-50");
  assert.equal(second.result.itemCode, "azc-100");
  const openings = await harness.db
    .select()
    .from(freeCaseOpenings)
    .where(eq(freeCaseOpenings.userId, user.userId));
  assert.equal(openings.length, 2);
  const status = await getFreeCaseStatus(harness.db, {
    userId: user.userId,
    clock: fixedClock(new Date(t0.getTime() + FREE_CASE_COOLDOWN_MS)),
  });
  assert.equal(status.lastOpening?.openingId, second.openingId);
  assert.equal(status.lastOpening?.itemCode, "azc-100");
  invalidateRecentWinsCache();
  const recent = await listRecentWins(harness.db, { limit: 20 });
  const firstWin = recent.items.find((row) => row.id === first.openingId);
  const secondWin = recent.items.find((row) => row.id === second.openingId);
  assert.equal(firstWin?.itemCode, "gram-50");
  assert.equal(secondWin?.itemCode, "azc-100");
});
