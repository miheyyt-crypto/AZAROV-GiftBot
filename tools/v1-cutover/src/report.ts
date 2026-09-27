export type Issue = { code: string; message: string };

export type CutoverReport = {
  process: "v1-cutover";
  mode: "audit" | "apply";
  source: {
    storePath: string;
    uploadsPath: string | null;
    sha256: string;
    storeVersion: unknown;
    readAt: string;
  };
  users: Record<string, unknown>;
  wallet: Record<string, unknown>;
  gram: Record<string, unknown>;
  referrals: Record<string, unknown>;
  referralCase: Record<string, unknown>;
  kick: Record<string, unknown>;
  tasks: Record<string, unknown>;
  welvura: Record<string, unknown>;
  inventory: Record<string, unknown>;
  orders: Record<string, unknown>;
  promo: Record<string, unknown>;
  notifications: Record<string, unknown>;
  cases: Record<string, unknown>;
  freeCase: Record<string, unknown>;
  xp: Record<string, unknown>;
  levels: Record<string, unknown>;
  achievements: Record<string, unknown>;
  streak: Record<string, unknown>;
  withdrawals: Record<string, unknown>;
  giveaways: Record<string, unknown>;
  activeGames: Record<string, unknown>;
  uploads: Record<string, unknown>;
  admin: Record<string, unknown>;
  omitted: string[];
  blockingIssues: Issue[];
  warnings: Issue[];
  legacyOnly: Issue[];
  planned?: {
    wallets: number;
    gram: number;
    referrals: number;
    entitlements: number;
    tasks: number;
    kickAccounts: number;
  };
};

export function reportContainsSecretLeak(json: string): boolean {
  return (
    /accessToken["']?\s*:/i.test(json) ||
    /refreshToken["']?\s*:/i.test(json) ||
    /KICK_CLIENT_SECRET/i.test(json) ||
    /TELEGRAM_BOT_TOKEN/i.test(json) ||
    /DATABASE_URL/i.test(json)
  );
}
