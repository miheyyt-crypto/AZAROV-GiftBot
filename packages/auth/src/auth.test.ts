import {
  adminRoleAssignments,
  adminRoles,
  sessions,
  telegramAccounts,
  users,
} from "@giftbot/db/schema";
import { eq } from "drizzle-orm";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { authenticateAdmin } from "./admin.js";
import { ADMIN_PERMISSIONS, authorizeAdmin } from "./authorize-admin.js";
import { authenticateMiniApp } from "./authenticate.js";
import {
  AuthDateExpiredError,
  ForbiddenError,
  SessionUnauthorizedError,
} from "./errors.js";
import type { AuthHarness } from "./harness.js";
import { startAuthHarness } from "./harness.js";
import { buildSignedInitData, verifyTelegramInitData } from "./init-data.js";
import { createAuthPolicy } from "./policy.js";
import {
  countActiveAdminSessions,
  countActiveMiniAppSessions,
  logoutAdminSession,
  logoutMiniAppSession,
  resolveAdminSession,
  resolveMiniAppSession,
  rotateAdminSession,
  rotateMiniAppSession,
  touchMiniAppSessionLastUsed,
} from "./session.js";

const botToken = "123456:TEST-BOT-TOKEN";
const policy = createAuthPolicy(botToken, { sessionTtlSeconds: 3_600 });

let harness: AuthHarness;
let nextTelegramId = 10_000n;

function signedInitData(
  telegramUserId: bigint,
  now = new Date(),
  extra: Record<string, unknown> = {},
): string {
  return buildSignedInitData(
    botToken,
    { id: Number(telegramUserId), first_name: "Test", ...extra },
    Math.floor(now.getTime() / 1000),
  );
}

async function assignSuperAdmin(userId: string): Promise<void> {
  const roles = await harness.db
    .select()
    .from(adminRoles)
    .where(eq(adminRoles.name, "super_admin"))
    .limit(1);
  const role = roles[0];
  assert.ok(role);
  await harness.db.insert(adminRoleAssignments).values({
    userId,
    roleId: role.id,
  });
}

before(async () => {
  harness = await startAuthHarness();
});

after(async () => {
  await harness.stop();
});

test("repeat Mini App auth rotates to one unrevoked session", async () => {
  const telegramUserId = nextTelegramId++;
  const first = await authenticateMiniApp(
    harness.db,
    signedInitData(telegramUserId),
    policy,
  );
  const second = await authenticateMiniApp(
    harness.db,
    signedInitData(telegramUserId, new Date(), { first_name: "Renamed" }),
    policy,
  );
  assert.equal(first.user.userId, second.user.userId);
  assert.notEqual(first.token, second.token);
  assert.equal(await countActiveMiniAppSessions(harness.db, first.user.userId), 1);
  await assert.rejects(
    () => resolveMiniAppSession(harness.db, first.token),
    SessionUnauthorizedError,
  );
  const resolved = await resolveMiniAppSession(harness.db, second.token);
  assert.equal(resolved.userId, second.user.userId);
});

test("logout revokes the current Mini App session", async () => {
  const telegramUserId = nextTelegramId++;
  const authed = await authenticateMiniApp(
    harness.db,
    signedInitData(telegramUserId),
    policy,
  );
  await logoutMiniAppSession(harness.db, authed.token);
  assert.equal(await countActiveMiniAppSessions(harness.db, authed.user.userId), 0);
  await assert.rejects(
    () => resolveMiniAppSession(harness.db, authed.token),
    SessionUnauthorizedError,
  );
});

test("blocked user is forbidden and sessions are revoked", async () => {
  const telegramUserId = nextTelegramId++;
  const authed = await authenticateMiniApp(
    harness.db,
    signedInitData(telegramUserId),
    policy,
  );
  await harness.db
    .update(users)
    .set({ status: "blocked" })
    .where(eq(users.id, authed.user.userId));

  await assert.rejects(
    () => authenticateMiniApp(harness.db, signedInitData(telegramUserId), policy),
    ForbiddenError,
  );
  assert.equal(await countActiveMiniAppSessions(harness.db, authed.user.userId), 0);
  await assert.rejects(
    () => resolveMiniAppSession(harness.db, authed.token),
    SessionUnauthorizedError,
  );
});

test("expired Mini App session is unauthorized", async () => {
  const telegramUserId = nextTelegramId++;
  const authed = await authenticateMiniApp(
    harness.db,
    signedInitData(telegramUserId),
    policy,
  );
  const expired = await rotateMiniAppSession(harness.db, {
    userId: authed.user.userId,
    ttlSeconds: 0,
  });
  await assert.rejects(
    () => resolveMiniAppSession(harness.db, expired.token),
    SessionUnauthorizedError,
  );
});

test("admin auth without a role is forbidden and does not open a Mini App session", async () => {
  const telegramUserId = nextTelegramId++;
  const mini = await authenticateMiniApp(
    harness.db,
    signedInitData(telegramUserId),
    policy,
  );
  await logoutMiniAppSession(harness.db, mini.token);

  await assert.rejects(
    () => authenticateAdmin(harness.db, signedInitData(telegramUserId), policy),
    ForbiddenError,
  );
  assert.equal(await countActiveMiniAppSessions(harness.db, mini.user.userId), 0);
  assert.equal(await countActiveAdminSessions(harness.db, mini.user.userId), 0);
});

test("admin auth with super_admin rotates one admin session", async () => {
  const telegramUserId = nextTelegramId++;
  const mini = await authenticateMiniApp(
    harness.db,
    signedInitData(telegramUserId),
    policy,
  );
  await assignSuperAdmin(mini.user.userId);

  const first = await authenticateAdmin(
    harness.db,
    signedInitData(telegramUserId),
    policy,
  );
  const second = await authenticateAdmin(
    harness.db,
    signedInitData(telegramUserId),
    policy,
  );
  assert.equal(first.user.userId, mini.user.userId);
  assert.equal(await countActiveAdminSessions(harness.db, mini.user.userId), 1);
  await assert.rejects(
    () => resolveAdminSession(harness.db, first.token),
    SessionUnauthorizedError,
  );
  await resolveAdminSession(harness.db, second.token);
  await logoutAdminSession(harness.db, second.token);
  await assert.rejects(
    () => resolveAdminSession(harness.db, second.token),
    SessionUnauthorizedError,
  );
});

test("unknown telegram user cannot admin-auth and is not provisioned", async () => {
  const telegramUserId = nextTelegramId++;
  await assert.rejects(
    () => authenticateAdmin(harness.db, signedInitData(telegramUserId), policy),
    ForbiddenError,
  );
  const accounts = await harness.db
    .select()
    .from(telegramAccounts)
    .where(eq(telegramAccounts.telegramUserId, telegramUserId));
  assert.equal(accounts.length, 0);
});

test("expired admin session is unauthorized", async () => {
  const telegramUserId = nextTelegramId++;
  const mini = await authenticateMiniApp(
    harness.db,
    signedInitData(telegramUserId),
    policy,
  );
  await assignSuperAdmin(mini.user.userId);
  const expired = await rotateAdminSession(harness.db, {
    userId: mini.user.userId,
    ttlSeconds: 0,
  });
  await assert.rejects(
    () => resolveAdminSession(harness.db, expired.token),
    SessionUnauthorizedError,
  );
});

test("super_admin session can authorize wallet.adjust and loses access without assignment", async () => {
  const telegramUserId = nextTelegramId++;
  const mini = await authenticateMiniApp(
    harness.db,
    signedInitData(telegramUserId),
    policy,
  );
  await assignSuperAdmin(mini.user.userId);
  const admin = await authenticateAdmin(
    harness.db,
    signedInitData(telegramUserId),
    policy,
  );
  const authorized = await authorizeAdmin(
    harness.db,
    admin.token,
    ADMIN_PERMISSIONS.walletAdjust,
  );
  assert.deepEqual(authorized.roles, ["super_admin"]);

  await harness.db
    .delete(adminRoleAssignments)
    .where(eq(adminRoleAssignments.userId, mini.user.userId));
  await assert.rejects(
    () =>
      authorizeAdmin(harness.db, admin.token, ADMIN_PERMISSIONS.walletAdjust),
    ForbiddenError,
  );
});

test("production defaults are frozen (30m initData / 30d session / 2h admin)", () => {
  const frozen = createAuthPolicy(botToken);
  assert.equal(frozen.defaultsStatus, "PRODUCTION");
  assert.equal(frozen.initDataMaxAgeSeconds, 1_800);
  assert.equal(frozen.sessionTtlSeconds, 2_592_000);
  assert.equal(frozen.adminSessionTtlSeconds, 7_200);
});

test("Mini App session stays usable after initData itself ages past 30 minutes", async () => {
  const telegramUserId = nextTelegramId++;
  const createdAt = new Date("2026-09-13T12:00:00.000Z");
  const frozenPolicy = createAuthPolicy(botToken);
  const authed = await authenticateMiniApp(
    harness.db,
    signedInitData(telegramUserId, createdAt),
    frozenPolicy,
    createdAt,
  );
  // InitData from create time would be stale 31 minutes later, but session resolve
  // must not re-check initData.
  const later = new Date(createdAt.getTime() + 31 * 60_000);
  assert.throws(
    () =>
      verifyTelegramInitData(
        signedInitData(telegramUserId, createdAt),
        botToken,
        later,
        frozenPolicy.initDataMaxAgeSeconds,
      ),
    AuthDateExpiredError,
  );
  const resolved = await resolveMiniAppSession(harness.db, authed.token);
  assert.equal(resolved.userId, authed.user.userId);
  assert.ok(authed.expiresAt.getTime() - createdAt.getTime() >= 2_592_000_000 - 1_000);
});

test("Mini App session expires after its 30-day TTL", async () => {
  const telegramUserId = nextTelegramId++;
  const frozenPolicy = createAuthPolicy(botToken);
  const authed = await authenticateMiniApp(
    harness.db,
    signedInitData(telegramUserId),
    frozenPolicy,
  );
  const expired = await rotateMiniAppSession(harness.db, {
    userId: authed.user.userId,
    ttlSeconds: frozenPolicy.sessionTtlSeconds,
  });
  // Force expiry by rewriting expires_at into the past via zero TTL rotation.
  const past = await rotateMiniAppSession(harness.db, {
    userId: authed.user.userId,
    ttlSeconds: 0,
  });
  assert.notEqual(expired.token, past.token);
  await assert.rejects(
    () => resolveMiniAppSession(harness.db, past.token),
    SessionUnauthorizedError,
  );
});

test("admin session expires after its 2-hour TTL", async () => {
  const telegramUserId = nextTelegramId++;
  const frozenPolicy = createAuthPolicy(botToken);
  const mini = await authenticateMiniApp(
    harness.db,
    signedInitData(telegramUserId),
    frozenPolicy,
  );
  await assignSuperAdmin(mini.user.userId);
  const admin = await authenticateAdmin(
    harness.db,
    signedInitData(telegramUserId),
    frozenPolicy,
  );
  assert.ok(
    admin.expiresAt.getTime() - Date.now() <=
      frozenPolicy.adminSessionTtlSeconds * 1000 + 5_000,
  );
  assert.ok(
    admin.expiresAt.getTime() - Date.now() >
      frozenPolicy.adminSessionTtlSeconds * 1000 - 60_000,
  );
  const past = await rotateAdminSession(harness.db, {
    userId: mini.user.userId,
    ttlSeconds: 0,
  });
  await assert.rejects(
    () => resolveAdminSession(harness.db, past.token),
    SessionUnauthorizedError,
  );
});

test("Mini App auth persists https photo_url and does not wipe it", async () => {
  const telegramUserId = nextTelegramId++;
  const photo = "https://t.me/i/userpic/320/test.jpg";
  const first = await authenticateMiniApp(
    harness.db,
    signedInitData(telegramUserId, new Date(), { photo_url: photo }),
    policy,
  );
  let account = (
    await harness.db
      .select()
      .from(telegramAccounts)
      .where(eq(telegramAccounts.userId, first.user.userId))
  )[0];
  assert.equal(account?.photoUrl, photo);

  await authenticateMiniApp(harness.db, signedInitData(telegramUserId), policy);
  account = (
    await harness.db
      .select()
      .from(telegramAccounts)
      .where(eq(telegramAccounts.userId, first.user.userId))
  )[0];
  assert.equal(account?.photoUrl, photo);

  await authenticateMiniApp(
    harness.db,
    signedInitData(telegramUserId, new Date(), {
      photo_url: "data:image/png;base64,xx",
    }),
    policy,
  );
  account = (
    await harness.db
      .select()
      .from(telegramAccounts)
      .where(eq(telegramAccounts.userId, first.user.userId))
  )[0];
  assert.equal(account?.photoUrl, photo);
});

test("resolveMiniAppSession does not stamp lastUsedAt; touch does", async () => {
  const telegramUserId = nextTelegramId++;
  const authed = await authenticateMiniApp(
    harness.db,
    signedInitData(telegramUserId),
    policy,
  );
  await resolveMiniAppSession(harness.db, authed.token);
  const before = (
    await harness.db
      .select()
      .from(sessions)
      .where(eq(sessions.userId, authed.user.userId))
  )[0];
  assert.equal(before?.lastUsedAt, null);
  await touchMiniAppSessionLastUsed(harness.db, authed.sessionId);
  const after = (
    await harness.db
      .select()
      .from(sessions)
      .where(eq(sessions.userId, authed.user.userId))
  )[0];
  assert.ok(after?.lastUsedAt);
});

