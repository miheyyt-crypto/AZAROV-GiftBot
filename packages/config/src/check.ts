import { loadEnv } from "./env.js";

const env = loadEnv();

process.stdout.write(
  `${JSON.stringify({
    level: "info",
    msg: "env skeleton ok",
    nodeEnv: env.NODE_ENV,
  })}\n`,
);
