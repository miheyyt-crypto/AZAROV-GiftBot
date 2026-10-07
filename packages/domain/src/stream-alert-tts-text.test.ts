import assert from "node:assert/strict";
import { test } from "node:test";
import {
  prepareStreamAlertTtsText,
  ruInt,
  splitStreamAlertTtsChunks,
} from "./stream-alert-tts-text.js";

export function buildMixed300Source(): string {
  const seed = "AZC 1000, 07.10.2026, цена 1 000! Привет :-) ";
  let mixed = seed;
  while (mixed.length < 280) {
    mixed += seed;
  }
  return (mixed.slice(0, 280) + "🔥😂👍 ").padEnd(300, "!");
}

test("numbers and AZC become words; original casing does not drop привет", () => {
  const spoken = prepareStreamAlertTtsText(
    "Привет, Азаров! Держи 1000 AZC 07.10.2026",
  );
  assert.match(spoken, /привет/);
  assert.doesNotMatch(spoken, /(?<!п)ривет/);
  assert.match(spoken, /тысяча/);
  assert.match(spoken, /а зэ цэ/);
  assert.match(spoken, /седьмое октября/);
  assert.match(spoken, /две тысячи двадцать шесть/);
});

test("latin words are transliterated instead of deleted", () => {
  const spoken = prepareStreamAlertTtsText("hello kick");
  assert.match(spoken, /хелло/);
  assert.match(spoken, /кикк|кик/);
  assert.doesNotMatch(spoken, /\bhello\b/i);
});

test("emoji is spoken as a word, not dropped silently", () => {
  const spoken = prepareStreamAlertTtsText("огонь 🔥");
  assert.match(spoken, /огонь/);
  assert.match(spoken, /эмодзи/);
});

test("ruInt uses тысяча not один тысяч", () => {
  assert.equal(ruInt(1000), "тысяча");
  assert.equal(ruInt(2000), "две тысячи");
});

test("chunks stay bounded", () => {
  const long = prepareStreamAlertTtsText("А. ".repeat(80));
  const chunks = splitStreamAlertTtsChunks(long, 40);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((chunk) => chunk.length <= 40));
});

test("mixed300 spoken form keeps the last phrase after normalize", () => {
  const source = buildMixed300Source();
  assert.equal(source.length, 300);
  const spoken = prepareStreamAlertTtsText(source);
  const chunks = splitStreamAlertTtsChunks(spoken, 180);
  const last = chunks[chunks.length - 1] ?? "";
  assert.ok(spoken.length > 300, "expanded spoken text should exceed 300 shop units");
  assert.match(last, /привет|эмодзи|тысяча|а зэ цэ/);
  assert.ok(chunks.length >= 2);
});
