import assert from "node:assert/strict";
import { test } from "node:test";
import { runBackupRestoreDrill } from "@giftbot/db/backup-restore-drill";

test("file backup recovers the probe row without a down migration", async () => {
  const result = await runBackupRestoreDrill();
  assert.equal(result.probe, "phase-14-backup-restore");
  assert.equal(result.methods.includes("logical-json"), true);
});
