import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ffmpegArgsDropAudio,
  obsVideoEncodeArgs,
} from "./stream-media-ffmpeg.js";

test("video transcode keeps or converts audio and does not use -an", () => {
  const withAudio = obsVideoEncodeArgs({
    src: "in.mov",
    out: "out.mp4",
    hasAudio: true,
  });
  assert.equal(ffmpegArgsDropAudio(withAudio), false);
  assert.ok(withAudio.includes("aac"));
  const silent = obsVideoEncodeArgs({
    src: "in.mp4",
    out: "out.mp4",
    hasAudio: false,
  });
  assert.equal(ffmpegArgsDropAudio(silent), false);
  assert.equal(silent.includes("aac"), false);
});

test("image GIF prepare still strips audio with -an", () => {
  assert.equal(ffmpegArgsDropAudio(["-y", "-i", "in.gif", "-an", "out.gif"]), true);
});
