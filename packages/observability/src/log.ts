import { correlationLogFields } from "./correlation.js";
import { redactSecrets } from "./redact.js";

export type LogLevel = "info" | "warn" | "error";

export type LogWriter = (line: string) => void;

export type StructuredLogger = {
  info: (msg: string, extra?: Record<string, unknown>) => void;
  warn: (msg: string, extra?: Record<string, unknown>) => void;
  error: (msg: string, extra?: Record<string, unknown>) => void;
};

function writeJson(
  writer: LogWriter,
  processName: string,
  level: LogLevel,
  msg: string,
  extra: Record<string, unknown>,
): void {
  const line = JSON.stringify(
    redactSecrets({
      level,
      msg,
      process: processName,
      ...correlationLogFields(),
      ...extra,
    }),
  );
  writer(`${line}\n`);
}

export function createLogger(
  processName: string,
  writer: LogWriter = (line) => {
    process.stdout.write(line);
  },
): StructuredLogger {
  return {
    info(msg, extra = {}) {
      writeJson(writer, processName, "info", msg, extra);
    },
    warn(msg, extra = {}) {
      writeJson(writer, processName, "warn", msg, extra);
    },
    error(msg, extra = {}) {
      writeJson(writer, processName, "error", msg, extra);
    },
  };
}
