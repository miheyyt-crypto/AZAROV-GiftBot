import * as schema from "./schema/index.js";

const tableCount = Object.keys(schema).length;

process.stdout.write(
  `${JSON.stringify({
    level: "info",
    msg: "db schema module ok",
    exports: tableCount,
    inboundEvents: "inbound_events",
    forbiddenDuplicateStores: ["kick_events", "telegram_events"],
  })}\n`,
);
