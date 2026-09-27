import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { WelvuraInvalidFileError } from "./errors.js";
import {
  createGiveawayImageStorage,
  GIVEAWAY_IMAGE_URL_RE,
} from "./file-storage.js";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

let root: string;

before(async () => {
  root = await mkdtemp(join(tmpdir(), "gb-giveaway-img-"));
});

after(async () => {
  await rm(root, { recursive: true, force: true });
});

test("giveaway image storage writes uuid filename and public url", async () => {
  const storage = createGiveawayImageStorage(root);
  const stored = await storage.put({ contentType: "image/png", bytes: PNG });
  assert.match(stored.imageUrl, GIVEAWAY_IMAGE_URL_RE);
  assert.equal(stored.imageUrl.includes(".."), false);
  assert.equal(stored.imageUrl.includes(root.replace(/\\/g, "/")), false);
  const disk = await readFile(storage.resolvePathFromPublicUrl(stored.imageUrl));
  assert.deepEqual(disk, PNG);
});

test("giveaway image storage rejects mime mismatch and traversal keys", async () => {
  const storage = createGiveawayImageStorage(root);
  await assert.rejects(
    () => storage.put({ contentType: "image/jpeg", bytes: PNG }),
    (err: unknown) => err instanceof WelvuraInvalidFileError,
  );
  await assert.rejects(
    () => storage.put({ contentType: "image/png", bytes: Buffer.from("not-an-image") }),
    (err: unknown) => err instanceof WelvuraInvalidFileError,
  );
  assert.throws(
    () => storage.resolvePathFromPublicUrl("/giveaways/media/../secret.png"),
    (err: unknown) => err instanceof WelvuraInvalidFileError,
  );
});
