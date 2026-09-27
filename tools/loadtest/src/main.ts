import { writeFileSync } from "node:fs";
import { runLoadtest } from "./run.js";

const report = await runLoadtest();
const body = `${JSON.stringify(report, null, 2)}\n`;
process.stdout.write(body);
const reportPath = process.env.LOADTEST_REPORT_PATH?.trim();
if (reportPath) {
  writeFileSync(reportPath, body, "utf8");
}
if (report.blockers.length > 0) {
  process.exitCode = 1;
}
