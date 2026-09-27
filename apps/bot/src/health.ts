import { writeProcessHealthResponse, type Metrics } from "@giftbot/observability";
import { createServer, type Server } from "node:http";

const processName = "bot" as const;

export type BotHealthOptions = {
  checkReady?: () => Promise<void>;
  metrics?: Metrics;
};

export function createBotHealthServer(options: BotHealthOptions = {}): Server {
  return createServer((req, res) => {
    void writeProcessHealthResponse(req, res, {
      processName,
      ...(options.checkReady ? { checkReady: options.checkReady } : {}),
      ...(options.metrics ? { metrics: options.metrics } : {}),
    }).then((handled) => {
      if (!handled) {
        res.writeHead(404);
        res.end();
      }
    });
  });
}

export function listen(
  server: Server,
  host: string,
  port: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });
}

export function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}
