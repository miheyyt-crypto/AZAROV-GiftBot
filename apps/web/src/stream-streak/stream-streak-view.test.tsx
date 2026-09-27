import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { StreamStreakCard } from "./StreamStreakCard.js";
import { EMPTY_STREAM_STREAK } from "./types.js";

test("stream streak card omits freeze copy while keeping chat hint", () => {
  const html = renderToStaticMarkup(
    createElement(StreamStreakCard, {
      streak: {
        ...EMPTY_STREAM_STREAK,
        freezeCount: 3,
        nextRewardAzc: "100",
      },
    }),
  );
  assert.match(html, /Напиши 10 сообщений в чат/);
  assert.match(html, /Следующий бонус/);
  assert.doesNotMatch(html, /Заморозки/);
  assert.doesNotMatch(html, /заморозка используется/);
});
