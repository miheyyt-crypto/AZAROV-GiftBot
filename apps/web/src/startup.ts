export type StartupPlan = {
  untilUsable: readonly string[];
  afterShell: readonly string[];
  sequentialCritical: number;
  parallelCritical: number;
};

export function planStartup(hasUsableSession: boolean): StartupPlan {
  const untilUsable = hasUsableSession
    ? (["bootstrap"] as const)
    : (["auth", "bootstrap"] as const);
  return {
    untilUsable,
    afterShell: [
      "free-case",
      "recent-wins",
      "stream-streak",
      "leaderboard",
      "giveaways",
      "contest-summary",
    ],
    sequentialCritical: untilUsable.length,
    parallelCritical: 0,
  };
}

export function assertStartupBudget(plan: StartupPlan): void {
  if (plan.sequentialCritical > 2 || plan.parallelCritical > 1) {
    throw new Error("startup request budget exceeded");
  }
}

export function sessionIsUsable(
  session: { expiresAt: string } | undefined,
  now = new Date(),
): boolean {
  if (!session) {
    return false;
  }
  return Date.parse(session.expiresAt) > now.getTime();
}
