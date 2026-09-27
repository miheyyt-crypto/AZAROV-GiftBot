import os from "node:os";

export type LoadEnvironment = {
  os: string;
  platform: string;
  arch: string;
  nodeVersion: string;
  cpuCount: number;
  totalMemoryBytes: number;
  freeMemoryBytes: number;
  dbPoolMax: number;
  apiProcessCount: number;
  workerProcessCount: number;
  botProcessCount: number;
  buildMode: string;
  nodeEnv: string | undefined;
  postgresNote: string;
  pnpmNote: string;
  authTtlNote: string;
};

export function captureLoadEnvironment(input: {
  dbPoolMax: number;
}): LoadEnvironment {
  return {
    os: `${os.type()} ${os.release()}`,
    platform: os.platform(),
    arch: os.arch(),
    nodeVersion: process.version,
    cpuCount: os.cpus().length,
    totalMemoryBytes: os.totalmem(),
    freeMemoryBytes: os.freemem(),
    dbPoolMax: input.dbPoolMax,
    apiProcessCount: 1,
    workerProcessCount: 1,
    botProcessCount: 1,
    buildMode: "production-like in-process Fastify (createApiApp.listen)",
    nodeEnv: process.env.NODE_ENV,
    postgresNote:
      "embedded-postgres via startDevPostgres (GIFTBOT_PG_DIR if set); migrations 0000→0017",
    pnpmNote: "invoke via npm exec --yes -- pnpm@10.15.1",
    authTtlNote:
      "PRODUCTION frozen: initData 1800s (create only), Mini App 2592000s, admin 7200s, future skew 60s",
  };
}
