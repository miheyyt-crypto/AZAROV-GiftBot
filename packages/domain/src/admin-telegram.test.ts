import {
  adminRoleAssignments,
  adminRoles,
  jobs,
} from "@giftbot/db/schema";
import { eq } from "drizzle-orm";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import {
  enqueueAdminTelegramNoticesIn,
  listAdminTelegramRecipients,
  userIsAssignedAdmin,
} from "./admin-telegram.js";
import type { DomainHarness } from "./harness.js";
import { startDomainHarness } from "./harness.js";
import { identifyTelegramUser } from "./telegram-identity.js";
import { provisionUser } from "./user.js";

let harness: DomainHarness;

before(async () => {
  harness = await startDomainHarness();
});

after(async () => {
  await harness.stop();
});

async function assignSuperAdmin(userId: string): Promise<void> {
  const roles = await harness.db
    .select()
    .from(adminRoles)
    .where(eq(adminRoles.name, "super_admin"))
    .limit(1);
  assert.ok(roles[0]);
  await harness.db.insert(adminRoleAssignments).values({
    userId,
    roleId: roles[0].id,
  });
}

test("admin telegram fan-out targets assigned admins only and is idempotent", async () => {
  const admin = await identifyTelegramUser(harness.db, {
    telegramUserId: 990001n,
    firstName: "Ops",
  });
  await assignSuperAdmin(admin.userId);
  const regular = await identifyTelegramUser(harness.db, {
    telegramUserId: 990002n,
    firstName: "User",
  });
  const unlinked = await provisionUser(harness.db);
  await assignSuperAdmin(unlinked.userId);

  assert.equal(await userIsAssignedAdmin(harness.db, admin.userId), true);
  assert.equal(await userIsAssignedAdmin(harness.db, regular.userId), false);

  const recipients = await listAdminTelegramRecipients(harness.db);
  assert.equal(
    recipients.some((row) => row.telegramUserId === 990001n),
    true,
  );
  assert.equal(
    recipients.some((row) => row.telegramUserId === 990002n),
    false,
  );

  await harness.db.transaction(async (tx) => {
    const created = await enqueueAdminTelegramNoticesIn(tx, {
      idempotencyPrefix: "welvura:admin:account:test-sub",
      text: "Новая заявка Welvura: привязка аккаунта",
    });
    assert.equal(created, 1);
    const replay = await enqueueAdminTelegramNoticesIn(tx, {
      idempotencyPrefix: "welvura:admin:account:test-sub",
      text: "Новая заявка Welvura: привязка аккаунта",
    });
    assert.equal(replay, 0);
  });

  const noticeJobs = await harness.db
    .select()
    .from(jobs)
    .where(eq(jobs.idempotencyKey, "welvura:admin:account:test-sub:990001"));
  assert.equal(noticeJobs.length, 1);
  assert.equal(noticeJobs[0]?.owner, "bot");
  assert.equal(noticeJobs[0]?.type, "telegram.send_message");
});
