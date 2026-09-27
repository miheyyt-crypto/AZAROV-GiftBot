import {
  CORRELATION_ID_HEADER,
  METRIC_NAMES,
  REQUEST_ID_HEADER,
  createCorrelationIds,
  createLogger,
  createMetrics,
  runWithCorrelation,
  sanitizeCorrelationId,
  type CorrelationIds,
  type Metrics,
  type StructuredLogger,
} from "@giftbot/observability";
import type { FastifyInstance, FastifyRequest } from "fastify";

declare module "fastify" {
  interface FastifyRequest {
    correlation: CorrelationIds | null;
  }
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

const SKIP_LOG = new Set(["/health/live", "/health/ready", "/metrics"]);

export function registerObservability(
  app: FastifyInstance,
  options: {
    metrics?: Metrics;
    logger?: StructuredLogger;
  } = {},
): { metrics: Metrics; logger: StructuredLogger } {
  const metrics = options.metrics ?? createMetrics();
  const logger = options.logger ?? createLogger("api");

  app.decorateRequest("correlation", null);

  app.addHook("onRequest", (request, reply, done) => {
    const incomingRequestId = sanitizeCorrelationId(
      headerValue(request.headers[REQUEST_ID_HEADER]),
    );
    const incomingCorrelationId = sanitizeCorrelationId(
      headerValue(request.headers[CORRELATION_ID_HEADER]),
    );
    const ids = createCorrelationIds({
      ...(incomingRequestId ? { requestId: incomingRequestId } : {}),
      ...(incomingCorrelationId
        ? { correlationId: incomingCorrelationId }
        : {}),
    });
    request.correlation = ids;
    reply.header(REQUEST_ID_HEADER, ids.requestId);
    reply.header(CORRELATION_ID_HEADER, ids.correlationId);
    runWithCorrelation(ids, () => done());
  });

  app.addHook("onResponse", (request, reply, done) => {
    if (!SKIP_LOG.has(request.url.split("?")[0] ?? "")) {
      metrics.increment(METRIC_NAMES.httpRequests);
      if (reply.statusCode >= 500) {
        metrics.increment(METRIC_NAMES.http5xx);
      }
      if (reply.statusCode === 429) {
        metrics.increment(METRIC_NAMES.http429);
      }
      const retryAfterHeader = reply.getHeader("retry-after");
      const retryAfter =
        retryAfterHeader === undefined
          ? undefined
          : Array.isArray(retryAfterHeader)
            ? retryAfterHeader[0]
            : String(retryAfterHeader);
      logger.info("http request", {
        method: request.method,
        path: request.url.split("?")[0],
        status: reply.statusCode,
        duration_ms: Math.round(reply.elapsedTime),
        ...(request.rateLimit
          ? {
              rate_limit_bucket: request.rateLimit.bucket,
              rate_limit_key_type: request.rateLimit.keyType,
            }
          : {}),
        ...(reply.statusCode === 429 && retryAfter
          ? { retry_after: retryAfter }
          : {}),
      });
    }
    done();
  });

  return { metrics, logger };
}

export function withRequestCorrelation<T>(
  request: FastifyRequest,
  fn: () => T,
): T {
  const ids = request.correlation;
  return ids ? runWithCorrelation(ids, fn) : fn();
}
