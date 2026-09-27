import { parseV1Export } from "./parse.js";

parseV1Export({
  format: "giftbot-v1-export",
  version: 1,
  users: [],
});

process.stdout.write(
  `${JSON.stringify({
    level: "info",
    msg: "v1-importer module ok",
    runtime: false,
    defaultMode: "snapshot",
  })}\n`,
);
