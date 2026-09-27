import { SMOKE_USERS, SMOKE_WEBHOOK_BURST, USER_LADDER, WEBHOOK_BURST } from "./stats.js";

process.stdout.write(
  `${JSON.stringify({
    level: "info",
    msg: "loadtest module ok",
    userLadder: USER_LADDER,
    webhookBurst: WEBHOOK_BURST,
    smokeUsers: SMOKE_USERS,
    smokeWebhookBurst: SMOKE_WEBHOOK_BURST,
  })}\n`,
);
