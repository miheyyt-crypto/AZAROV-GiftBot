import type { AuthDatabase } from "@giftbot/auth";
import {
  liveBody,
  metricsBody,
  notReadyBody,
  readyBody,
  type Metrics,
} from "@giftbot/observability";
import { sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";

export function registerHealthRoutes(
  app: FastifyInstance,
  db?: AuthDatabase,
  metrics?: Metrics,
): void {
  app.get("/health/live", async () => liveBody("api"));

  app.get("/health/ready", async (_request, reply) => {
    if (!db) {
      return reply.code(503).send(notReadyBody("api"));
    }
    await db.execute(sql`select 1`);
    return readyBody("api");
  });

  if (metrics) {
    app.get("/metrics", async () => metricsBody("api", metrics));
  }
}
