import type { LoadEnvironment } from "./env.js";
import type { ScenarioResult } from "./scenarios.js";

export type LoadReport = {
  process: "loadtest";
  productionReadyClaim: false;
  environment?: LoadEnvironment;
  rateLimitOverride: {
    status: "TEMPORARY_UNCONFIRMED";
    reason: "harness shares one IP; production default is 400/60s per route key";
  };
  scenarios: ScenarioResult[];
  notes?: string[];
  blockers: string[];
};

export function collectBlockers(
  scenarios: ScenarioResult[],
  extras: string[] = [],
): string[] {
  const blockers = [...extras.filter((e) => e.includes("failed") || e.includes("still open") || e.includes("not ready"))];
  for (const scenario of scenarios) {
    if (scenario.requests.errors > 0) {
      blockers.push(
        `${scenario.name}: ${String(scenario.requests.errors)} failed requests ${JSON.stringify(scenario.requests.statuses)}`,
      );
    }
    const fiveXx = Object.entries(scenario.requests.statuses).filter(([code]) =>
      code.startsWith("5"),
    );
    if (fiveXx.length > 0) {
      blockers.push(`${scenario.name}: HTTP 5xx`);
    }
    if (scenario.requests.statuses["0"]) {
      blockers.push(`${scenario.name}: transport failure`);
    }
  }
  return blockers;
}

export function buildReport(
  scenarios: ScenarioResult[],
  extras: string[] = [],
  environment?: LoadEnvironment,
): LoadReport {
  return {
    process: "loadtest",
    productionReadyClaim: false,
    ...(environment ? { environment } : {}),
    rateLimitOverride: {
      status: "TEMPORARY_UNCONFIRMED",
      reason: "harness shares one IP; production default is 400/60s per route key",
    },
    scenarios,
    notes: extras,
    blockers: collectBlockers(scenarios, extras),
  };
}
