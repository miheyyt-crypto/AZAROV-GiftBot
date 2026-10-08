import assert from "node:assert/strict";
import { test } from "node:test";
import { StreamGifInvalidFileError } from "./errors.js";
import { inspectGif, minimalTestGif, STREAM_GIF_MAX_BYTES } from "./gif-inspect.js";

test("inspectGif accepts a decodable 1x1 GIF89a", () => {
  const gif = minimalTestGif();
  const inspected = inspectGif(gif);
  assert.equal(inspected.width, 1);
  assert.equal(inspected.height, 1);
  assert.equal(inspected.frameCount, 1);
});

test("inspectGif rejects JPEG bytes even with a .gif name", () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
  assert.throws(() => inspectGif(jpeg), StreamGifInvalidFileError);
});

test("inspectGif rejects oversize resolution in the GIF header", () => {
  const gif = Buffer.from(minimalTestGif());
  gif.writeUInt16LE(2000, 6);
  gif.writeUInt16LE(2000, 8);
  assert.throws(() => inspectGif(gif), StreamGifInvalidFileError);
});

test("inspectGif rejects truncated and oversized payloads", () => {
  assert.throws(() => inspectGif(Buffer.from("GIF89a")), StreamGifInvalidFileError);
  assert.throws(
    () => inspectGif(Buffer.alloc(STREAM_GIF_MAX_BYTES + 1, 0)),
    StreamGifInvalidFileError,
  );
});

test("inspectGif caps decoded pixel volume independent of frame count", () => {
  assert.throws(
    () => inspectGif(minimalTestGif(), { maxDecodedPixels: 0 }),
    StreamGifInvalidFileError,
  );
});

test("inspectGif caps LZW wall time independent of resolution", () => {
  assert.throws(
    () =>
      inspectGif(minimalTestGif(), {
        lzwMaxMs: 0,
        now: (() => {
          let n = 0;
          return () => {
            n += 1;
            return n > 3 ? 50 : 0;
          };
        })(),
      }),
    StreamGifInvalidFileError,
  );
});
