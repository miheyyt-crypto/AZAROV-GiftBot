import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { auditUploadFile, resolveInsideRoot } from "./uploads.js";

test("path traversal protection for uploads", async () => {
  assert.equal(resolveInsideRoot(join(tmpdir(), "u"), "..\\secret"), null);
  const root = join(tmpdir(), `cutover-up-${String(Date.now())}`);
  await mkdir(join(root, "partner-submissions"), { recursive: true });
  const rel = "partner-submissions/ok.png";
  await writeFile(
    join(root, rel),
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  );
  const audit = await auditUploadFile(root, rel);
  assert.equal(audit.exists, true);
  assert.equal(audit.contentType, "image/png");
  const escape = await auditUploadFile(root, "../outside.png");
  assert.equal(escape.traversal, true);
});
