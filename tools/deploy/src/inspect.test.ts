import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertBackupUsesPgDump,
  assertEnvExampleHasNoSecrets,
  assertGitignoresSecrets,
  assertIndependentUnits,
  assertNginxApiOnly,
  assertNoDownSql,
  assertRollbackIsArtifact,
  inspectDeploy,
} from "./inspect.js";
import { assertNotDownMigration } from "./refuse-down.js";

test("three systemd units stay independent and migrate is expand-only oneshot", async () => {
  const inspection = await inspectDeploy();
  assertIndependentUnits(inspection);
  assert.equal(inspection.drizzleSql.includes("0000_phase2_foundation.sql"), true);
});

test("nginx proxies Mini App and API to the API process only", async () => {
  const inspection = await inspectDeploy();
  assertNginxApiOnly(inspection.nginx);
});

test("rollback switches a previous artifact and refuses down migrations", async () => {
  const inspection = await inspectDeploy();
  assertRollbackIsArtifact(inspection.rollback);
  assert.throws(() => assertNotDownMigration(["--down"]), /previous compatible artifact/);
  assert.throws(() => assertNotDownMigration(["migrate"]), /previous compatible artifact/);
  assertNotDownMigration(["/opt/giftbot/releases/previous"]);
});

test("VPS backup/restore use pg_dump and drizzle has no down SQL", async () => {
  const inspection = await inspectDeploy();
  assertBackupUsesPgDump(inspection.backup, inspection.restore);
  assertNoDownSql(inspection.drizzleSql);
});

test("secrets stay out of git-tracked env examples", async () => {
  const inspection = await inspectDeploy();
  assertEnvExampleHasNoSecrets(inspection.envExample);
  assertGitignoresSecrets(inspection.gitignore);
});
