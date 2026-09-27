export type MiniAppSectionId = "home" | "referrals" | "kick" | "games";

export type BootstrapPayload = {
  user: {
    publicId: string;
    displayName?: string;
    avatarUrl?: string | null;
  };
  wallet: {
    balanceMinor: string;
    currencyCode: string;
  };
  session: {
    expiresAt: string;
  };
  flags: {
    kickLinked: boolean;
    isSuperAdmin: boolean;
  };
  counters: {
    referralsAttributed: number;
  };
  referralCode: string;
  configVersion: string;
};

export type SessionCache = {
  token: string;
  expiresAt: string;
};

export type SectionPayload =
  | { section: "home"; available: true }
  | {
      section: "referrals";
      available: true;
      referralCode: string;
      referralsAttributed: number;
    }
  | { section: "kick"; available: true; kickLinked: boolean }
  | {
      section: "games";
      available: true;
      games: Array<{
        id: string;
        slug: string;
        title: string;
        settlementMode: string;
        allowedBetMinor: string[];
      }>;
    };
