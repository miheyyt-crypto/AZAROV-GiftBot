import { inspectDeploy } from "./inspect.js";

const inspection = await inspectDeploy();

process.stdout.write(
  `${JSON.stringify({
    level: "info",
    msg: "deploy module ok",
    units: Object.keys(inspection.units),
    drizzleFiles: inspection.drizzleSql.length,
  })}\n`,
);
