import { v1ImportIdentities, v1ImportRuns, wallets } from "@giftbot/db/schema";
import type { GiftbotDb, GiftbotTx } from "@giftbot/domain";
import {
  applyIn,
  asBigInt,
  identifyTelegramUserIn,
  reconcileWallet,
} from "@giftbot/domain";
import { eq } from "drizzle-orm";
import {
  hashV1Export,
  type ImportMode,
  type V1ExportDocument,
  type V1ExportUser,
} from "./parse.js";

export type ImportRowResult = {
  telegramUserId: string;
  action: "imported" | "skipped" | "conflict" | "would_import";
  reason?: string;
  userId?: string;
};

export type ImportReport = {
  mode: ImportMode;
  dryRun: boolean;
  sourceSha256: string;
  usersRead: number;
  imported: number;
  skipped: number;
  conflicts: number;
  reconcileOk: boolean;
  rows: ImportRowResult[];
};

function conflict(telegramUserId: bigint, reason: string): ImportRowResult {
  return {
    telegramUserId: telegramUserId.toString(),
    action: "conflict",
    reason,
  };
}

function validateUserForMode(user: V1ExportUser, mode: ImportMode): string | undefined {
  if (mode === "snapshot" && user.ledger.length > 0) {
    return "snapshot refuses V1 ledger rows (would double-count with opening)";
  }
  if (mode === "full_history") {
    if (user.ledger.length === 0) {
      return "full_history requires ledger rows";
    }
    const sum = user.ledger.reduce((acc, row) => acc + row.amountMinor, 0n);
    if (sum !== user.balanceMinor) {
      return "full_history ledger sum must equal balance_minor";
    }
    let running = 0n;
    for (const row of user.ledger) {
      running += row.amountMinor;
      if (running < 0n) {
        return "full_history running balance would go negative";
      }
    }
  }
  return undefined;
}

async function loadIdentity(tx: GiftbotTx, telegramUserId: bigint) {
  const rows = await tx
    .select()
    .from(v1ImportIdentities)
    .where(eq(v1ImportIdentities.telegramUserId, telegramUserId))
    .limit(1);
  return rows[0];
}

async function applySnapshot(
  tx: GiftbotTx,
  user: V1ExportUser,
  runId: string,
): Promise<ImportRowResult> {
  const identified = await identifyTelegramUserIn(tx, {
    telegramUserId: user.telegramUserId,
    ...(user.username ? { username: user.username } : {}),
    ...(user.firstName ? { firstName: user.firstName } : {}),
    ...(user.lastName ? { lastName: user.lastName } : {}),
    ...(user.locale ? { languageCode: user.locale } : {}),
  });

  const existing = await loadIdentity(tx, user.telegramUserId);
  if (existing) {
    if (
      existing.mode === "snapshot" &&
      asBigInt(existing.importedBalanceMinor) === user.balanceMinor
    ) {
      return {
        telegramUserId: user.telegramUserId.toString(),
        action: "skipped",
        reason: "already imported",
        userId: existing.userId,
      };
    }
    return conflict(user.telegramUserId, "identity already imported with a different mapping");
  }

  const walletRows = await tx
    .select()
    .from(wallets)
    .where(eq(wallets.userId, identified.userId))
    .for("update");
  const wallet = walletRows[0];
  if (!wallet) {
    return conflict(user.telegramUserId, "wallet missing after identify");
  }

  const opening = asBigInt(wallet.openingBalanceMinor);
  const balance = asBigInt(wallet.balanceMinor);
  if (opening === 0n) {
    await tx
      .update(wallets)
      .set({
        openingBalanceMinor: user.balanceMinor,
        balanceMinor: balance + user.balanceMinor,
        version: asBigInt(wallet.version) + 1n,
        updatedAt: new Date(),
      })
      .where(eq(wallets.id, wallet.id));
  } else if (opening !== user.balanceMinor) {
    return conflict(
      user.telegramUserId,
      "wallet already has a different opening_balance_minor",
    );
  }

  await tx.insert(v1ImportIdentities).values({
    telegramUserId: user.telegramUserId,
    userId: identified.userId,
    mode: "snapshot",
    importedBalanceMinor: user.balanceMinor,
    importRunId: runId,
    ...(user.legacyId ? { sourceLegacyId: user.legacyId } : {}),
  });

  return {
    telegramUserId: user.telegramUserId.toString(),
    action: "imported",
    userId: identified.userId,
  };
}

async function applyHistory(
  tx: GiftbotTx,
  user: V1ExportUser,
  runId: string,
): Promise<ImportRowResult> {
  const identified = await identifyTelegramUserIn(tx, {
    telegramUserId: user.telegramUserId,
    ...(user.username ? { username: user.username } : {}),
    ...(user.firstName ? { firstName: user.firstName } : {}),
    ...(user.lastName ? { lastName: user.lastName } : {}),
    ...(user.locale ? { languageCode: user.locale } : {}),
  });

  const existing = await loadIdentity(tx, user.telegramUserId);
  if (existing && existing.mode !== "full_history") {
    return conflict(user.telegramUserId, "identity already imported in snapshot mode");
  }

  const walletRows = await tx
    .select()
    .from(wallets)
    .where(eq(wallets.userId, identified.userId))
    .for("update");
  const wallet = walletRows[0];
  if (!wallet) {
    return conflict(user.telegramUserId, "wallet missing after identify");
  }
  if (asBigInt(wallet.openingBalanceMinor) !== 0n) {
    return conflict(
      user.telegramUserId,
      "non-zero opening plus history would double-count",
    );
  }

  let replayedAll = existing !== undefined;
  for (const row of user.ledger) {
    const result = await applyIn(tx, {
      userId: identified.userId,
      type: row.type,
      amountMinor: row.amountMinor,
      idempotencyKey: `import:v1:${row.legacyTxId}`,
      actorType: "system",
      reason: "v1 history import",
      referenceType: "v1_import",
      metadata: { legacy_tx_id: row.legacyTxId },
    });
    if (!result.replayed) {
      replayedAll = false;
    }
  }

  if (!existing) {
    await tx.insert(v1ImportIdentities).values({
      telegramUserId: user.telegramUserId,
      userId: identified.userId,
      mode: "full_history",
      importedBalanceMinor: user.balanceMinor,
      importRunId: runId,
      ...(user.legacyId ? { sourceLegacyId: user.legacyId } : {}),
    });
  }

  return {
    telegramUserId: user.telegramUserId.toString(),
    action: replayedAll ? "skipped" : "imported",
    ...(replayedAll ? { reason: "already imported" } : {}),
    userId: identified.userId,
  };
}

export function planV1Import(
  source: V1ExportDocument,
  mode: ImportMode,
): ImportReport {
  const rows: ImportRowResult[] = [];
  for (const user of source.users) {
    const reason = validateUserForMode(user, mode);
    if (reason) {
      rows.push(conflict(user.telegramUserId, reason));
      continue;
    }
    rows.push({
      telegramUserId: user.telegramUserId.toString(),
      action: "would_import",
    });
  }
  const conflicts = rows.filter((row) => row.action === "conflict").length;
  return {
    mode,
    dryRun: true,
    sourceSha256: hashV1Export(source),
    usersRead: source.users.length,
    imported: 0,
    skipped: 0,
    conflicts,
    reconcileOk: conflicts === 0,
    rows,
  };
}

export async function importV1Users(
  db: GiftbotDb,
  source: V1ExportDocument,
  options: { mode: ImportMode; dryRun: boolean },
): Promise<ImportReport> {
  if (options.dryRun) {
    return planV1Import(source, options.mode);
  }

  const rows: ImportRowResult[] = [];
  for (const user of source.users) {
    const reason = validateUserForMode(user, options.mode);
    if (reason) {
      rows.push(conflict(user.telegramUserId, reason));
    }
  }

  const planned = source.users.filter(
    (user) => !validateUserForMode(user, options.mode),
  );

  const runRows = await db
    .insert(v1ImportRuns)
    .values({
      mode: options.mode,
      dryRun: false,
      sourceSha256: hashV1Export(source),
      usersRead: source.users.length,
      usersImported: 0,
      usersSkipped: 0,
      usersConflicted: 0,
      reconcileOk: false,
      report: {},
    })
    .returning();
  const run = runRows[0];
  if (!run) {
    throw new Error("failed to create v1_import_runs row");
  }

  for (const user of planned) {
    const row = await db.transaction(async (tx) =>
      options.mode === "snapshot"
        ? applySnapshot(tx, user, run.id)
        : applyHistory(tx, user, run.id),
    );
    rows.push(row);
  }

  let reconcileOk = rows.every((row) => row.action !== "conflict");
  for (const row of rows) {
    if (!row.userId || row.action === "conflict") {
      continue;
    }
    const report = await reconcileWallet(db, row.userId);
    if (!report.consistent) {
      reconcileOk = false;
      row.action = "conflict";
      row.reason = "reconcile mismatch after import";
    }
  }

  const imported = rows.filter((row) => row.action === "imported").length;
  const skipped = rows.filter((row) => row.action === "skipped").length;
  const conflicts = rows.filter((row) => row.action === "conflict").length;

  await db
    .update(v1ImportRuns)
    .set({
      usersImported: imported,
      usersSkipped: skipped,
      usersConflicted: conflicts,
      reconcileOk,
      report: {
        rows,
      },
    })
    .where(eq(v1ImportRuns.id, run.id));

  return {
    mode: options.mode,
    dryRun: false,
    sourceSha256: hashV1Export(source),
    usersRead: source.users.length,
    imported,
    skipped,
    conflicts,
    reconcileOk,
    rows,
  };
}
