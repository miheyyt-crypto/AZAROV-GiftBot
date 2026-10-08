import assert from "node:assert/strict";
import { test } from "node:test";
import {
  StreamMediaCorruptError,
  StreamMediaLimitError,
  StreamMediaTooLargeError,
  StreamMediaUnsupportedFormatError,
} from "./errors.js";
import {
  inspectGif,
  minimalTestGif,
  STREAM_GIF_MAX_BYTES,
  testGifWithScreenAndFrame,
} from "./gif-inspect.js";
import { inspectStreamMedia } from "./media-inspect.js";

test("inspectGif accepts a decodable 1x1 GIF89a", () => {
  const gif = minimalTestGif();
  const inspected = inspectGif(gif);
  assert.equal(inspected.width, 1);
  assert.equal(inspected.height, 1);
  assert.equal(inspected.frameCount, 1);
});

test("inspectGif names JPEG as unsupported format, not corrupt", () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
  assert.throws(() => inspectGif(jpeg), StreamMediaUnsupportedFormatError);
});

test("inspectGif rejects oversize resolution as a limit, not corrupt", () => {
  const down = Buffer.from(minimalTestGif());
  down.writeUInt16LE(2000, 6);
  down.writeUInt16LE(2000, 8);
  const inspected = inspectGif(down);
  assert.equal(inspected.needsDownscale, true);
  const huge = Buffer.from(minimalTestGif());
  huge.writeUInt16LE(8193, 6);
  huge.writeUInt16LE(8193, 8);
  assert.throws(() => inspectGif(huge), StreamMediaLimitError);
});

test("inspectGif rejects truncated as corrupt and oversized as too large", () => {
  assert.throws(() => inspectGif(Buffer.from("GIF89a")), StreamMediaCorruptError);
  assert.throws(
    () => inspectGif(Buffer.alloc(STREAM_GIF_MAX_BYTES + 1, 0)),
    StreamMediaTooLargeError,
  );
});

test("inspectGif caps decoded pixel volume independent of frame count", () => {
  assert.throws(
    () => inspectGif(minimalTestGif(), { decodePixels: true, maxDecodedPixels: 0 }),
    StreamMediaLimitError,
  );
});

test("inspectGif caps LZW wall time independent of resolution", () => {
  assert.throws(
    () =>
      inspectGif(minimalTestGif(), {
        decodePixels: true,
        lzwMaxMs: 0,
        now: (() => {
          let n = 0;
          return () => {
            n += 1;
            return n > 3 ? 50 : 0;
          };
        })(),
      }),
    StreamMediaLimitError,
  );
});

test("inspectGif reads image descriptor width at spec offset, not left/top", () => {
  const gif = testGifWithScreenAndFrame(480, 270, 480, 270);
  const inspected = inspectGif(gif);
  assert.equal(inspected.needsDownscale, false);
  assert.equal(inspected.frameCount, 1);
});

test("a normal 480x480 GIF is accepted with real sizes, not STREAM_MEDIA_LIMIT", () => {
  const gif = testGifWithScreenAndFrame(480, 480, 480, 480);
  const inspected = inspectGif(gif);
  assert.equal(inspected.width, 480);
  assert.equal(inspected.height, 480);
  assert.equal(inspected.needsDownscale, false);
  const media = inspectStreamMedia(gif);
  assert.equal(media.kind, "gif");
  assert.equal(media.width, 480);
  assert.equal(media.height, 480);
  assert.equal(media.needsPrepare, false);
});

test("inspectGif stages frames over 1920 for prepare instead of rejecting", () => {
  const gif = testGifWithScreenAndFrame(480, 480, 2000, 1080);
  const inspected = inspectGif(gif);
  assert.equal(inspected.needsDownscale, true);
  assert.equal(inspected.width, 480);
  assert.equal(inspected.height, 480);
  assert.throws(
    () => inspectGif(gif, { decodePixels: true }),
    StreamMediaLimitError,
  );
});
