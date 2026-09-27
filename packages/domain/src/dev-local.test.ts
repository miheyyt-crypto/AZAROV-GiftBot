import { gramBalances } from "@giftbot/db/schema";
import { eq } from "drizzle-orm";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { ensureDevLocalIdentity } from "./dev-local.js";
import { GRAM_MINOR_PER_UNIT } from "./gram.js";
import type { DomainHarness } from "./harness.js";
import { startDomainHarness } from "./harness.js";
import { asBigInt } from "./money.js";

let harness: DomainHarness;

before(async () => {
  harness = await startDomainHarness();
});

after(async () => {
  await harness.stop();
});

test("dev local seed does not reset gram after gameplay credits", async () => {
  const first = await ensureDevLocalIdentity(harness.db, "user");
  await harness.db
    .update(gramBalances)
    .set({
      amountMinor: 25n * GRAM_MINOR_PER_UNIT + 1_000_000n,
      updatedAt: new Date(),
    })
    .where(eq(gramBalances.userId, first.userId));

  await ensureDevLocalIdentity(harness.db, "user");

  const rows = await harness.db
    .select()
    .from(gramBalances)
    .where(eq(gramBalances.userId, first.userId))
    .limit(1);
  assert.equal(
    asBigInt(rows[0]?.amountMinor ?? 0n),
    25n * GRAM_MINOR_PER_UNIT + 1_000_000n,
  );
});
