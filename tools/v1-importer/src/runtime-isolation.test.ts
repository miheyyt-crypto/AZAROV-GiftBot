import assert from "node:assert/strict";
import { test } from "node:test";
import { assertRuntimeDoesNotImportV1 } from "./runtime-isolation.js";

test("API, Bot, Worker, and Web do not depend on the V1 importer", async () => {
  await assertRuntimeDoesNotImportV1();
  assert.ok(true);
});
