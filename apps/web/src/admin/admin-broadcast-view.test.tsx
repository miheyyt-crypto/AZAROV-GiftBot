import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AdminBroadcastView } from "./AdminBroadcastView.js";

test("admin broadcast view renders composer preview and history", () => {
  const html = renderToStaticMarkup(
    createElement(AdminBroadcastView, {
      message: "Привет",
      photoName: "shot.png",
      photoPreviewUrl: "/broadcasts/media/x.png",
      buttonEnabled: true,
      buttonKind: "web_app",
      buttonText: "Открыть GiftBot",
      buttonUrl: "https://example.com",
      recipientCount: 604,
      items: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          status: "sending",
          messageText: "Привет",
          messagePreview: "Привет",
          hasPhoto: true,
          photoUrl: "/broadcasts/media/x.png",
          button: null,
          recipientCount: 604,
          sentCount: 418,
          failedCount: 3,
          createdAt: "2026-09-21T00:00:00.000Z",
          startedAt: "2026-09-21T00:00:00.000Z",
          completedAt: null,
        },
      ],
      active: {
        id: "11111111-1111-4111-8111-111111111111",
        status: "sending",
        messageText: "Привет",
        messagePreview: "Привет",
        hasPhoto: true,
        photoUrl: "/broadcasts/media/x.png",
        button: null,
        recipientCount: 604,
        sentCount: 418,
        failedCount: 3,
        createdAt: "2026-09-21T00:00:00.000Z",
        startedAt: "2026-09-21T00:00:00.000Z",
        completedAt: null,
      },
      onMessageChange: () => undefined,
      onPhotoFile: () => undefined,
      onPhotoClear: () => undefined,
      onButtonEnabledChange: () => undefined,
      onButtonKindChange: () => undefined,
      onButtonTextChange: () => undefined,
      onButtonUrlChange: () => undefined,
      onSend: () => undefined,
      onOpen: () => undefined,
    }),
  );
  assert.match(html, /Рассылка в Telegram/);
  assert.match(html, /Сообщение/);
  assert.match(html, /Получателей: 604/);
  assert.match(html, /Отправить всем/);
  assert.match(html, /418 \/ 604/);
  assert.match(html, /Ошибок: 3/);
  assert.match(html, /Открыть GiftBot/);
});
