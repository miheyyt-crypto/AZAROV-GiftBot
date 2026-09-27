import { createCorrelationIds, runWithCorrelation } from "./correlation.js";
import { createLogger } from "./log.js";
import { createMetrics } from "./metrics.js";
import { redactSecrets } from "./redact.js";

const ids = createCorrelationIds({ requestId: "check-request" });
runWithCorrelation(ids, () => {
  createLogger("observability").info("observability module ok");
});

process.stdout.write(
  `${JSON.stringify({
    level: "info",
    msg: "observability module ok",
    redacted: redactSecrets({ authorization: "secret" }),
    increment: typeof createMetrics().increment,
  })}\n`,
);
