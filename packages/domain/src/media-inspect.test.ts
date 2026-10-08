import assert from "node:assert/strict";
import { test } from "node:test";
import {
  StreamMediaCodecUnsupportedError,
  StreamMediaTooLargeError,
  StreamMediaUnsupportedFormatError,
} from "./errors.js";
import { minimalTestGif } from "./gif-inspect.js";
import {
  inspectStreamMedia,
  minimalTestJpeg,
  minimalTestPng,
  prepareStreamMedia,
  STREAM_MEDIA_MAX_BYTES,
} from "./media-inspect.js";

function box(type: string, payload: Buffer): Buffer {
  const buf = Buffer.alloc(8 + payload.length);
  buf.writeUInt32BE(8 + payload.length, 0);
  buf.write(type, 4, 4, "ascii");
  payload.copy(buf, 8);
  return buf;
}

function hevcMp4(): Buffer {
  const sample = Buffer.alloc(32);
  sample.writeUInt16BE(64, 24);
  sample.writeUInt16BE(48, 26);
  const stsd = Buffer.concat([
    Buffer.from([0, 0, 0, 0, 0, 0, 0, 1]),
    box("hvc1", sample),
  ]);
  const stbl = box("stbl", stsd);
  const minf = box("minf", stbl);
  const mdia = box("mdia", minf);
  const trak = box("trak", mdia);
  const moov = box("moov", trak);
  const ftyp = box("ftyp", Buffer.from("isom"));
  return Buffer.concat([ftyp, moov]);
}

test("inspectStreamMedia accepts JPEG PNG GIF by content not name", () => {
  const jpeg = inspectStreamMedia(minimalTestJpeg());
  assert.equal(jpeg.contentType, "image/jpeg");
  assert.equal(jpeg.width, 1);
  const png = inspectStreamMedia(minimalTestPng());
  assert.equal(png.contentType, "image/png");
  const gif = inspectStreamMedia(minimalTestGif());
  assert.equal(gif.kind, "gif");
  assert.equal(gif.needsPrepare, false);
});

test("inspectStreamMedia does not call random bytes corrupt", () => {
  assert.throws(
    () => inspectStreamMedia(Buffer.from("not-a-media-file")),
    StreamMediaUnsupportedFormatError,
  );
});

test("inspectStreamMedia rejects payloads over 10 MiB as too large", () => {
  const jpeg = minimalTestJpeg();
  const exact = Buffer.concat([
    jpeg,
    Buffer.alloc(STREAM_MEDIA_MAX_BYTES - jpeg.byteLength),
  ]);
  assert.equal(inspectStreamMedia(exact).contentType, "image/jpeg");
  assert.throws(
    () => inspectStreamMedia(Buffer.alloc(STREAM_MEDIA_MAX_BYTES + 1, 0xff)),
    StreamMediaTooLargeError,
  );
});

test("prepareStreamMedia asks for conversion on HEVC instead of calling it corrupt", async () => {
  const bytes = hevcMp4();
  const inspected = inspectStreamMedia(bytes);
  assert.equal(inspected.obsNative, false);
  assert.equal(inspected.codec, "hvc1");
  await assert.rejects(
    () => prepareStreamMedia(bytes),
    StreamMediaCodecUnsupportedError,
  );
});

test("prepareStreamMedia uses transcoder for unsupported container codecs", async () => {
  const converted = hevcMp4();
  converted.write("avc1", converted.indexOf("hvc1"), 4, "ascii");
  const prepared = await prepareStreamMedia(hevcMp4(), {
    transcoder: {
      transcodeToObsMp4: async () => converted,
    },
  });
  assert.equal(prepared.contentType, "video/mp4");
  assert.equal(prepared.obsNative, true);
});
