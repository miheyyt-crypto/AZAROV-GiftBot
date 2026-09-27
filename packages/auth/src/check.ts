import {
  createAuthPolicy,
  PRODUCTION_AUTH_DEFAULTS,
} from "./policy.js";
import { hashToken, issueOpaqueToken } from "./tokens.js";

const policy = createAuthPolicy("check-token");
const token = issueOpaqueToken();

process.stdout.write(
  `${JSON.stringify({
    level: "info",
    msg: "auth module ok",
    defaultsStatus: policy.defaultsStatus,
    initDataMaxAgeSeconds: PRODUCTION_AUTH_DEFAULTS.initDataMaxAgeSeconds,
    sessionTtlSeconds: PRODUCTION_AUTH_DEFAULTS.sessionTtlSeconds,
    adminSessionTtlSeconds: PRODUCTION_AUTH_DEFAULTS.adminSessionTtlSeconds,
    tokenHashBytes: hashToken(token).length,
  })}\n`,
);
