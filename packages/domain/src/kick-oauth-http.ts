import { normalizeHttpsAvatarUrl } from "./https-url.js";

export type KickTokenSet = {
  accessToken: string;
  refreshToken?: string;
  expiresIn: number;
  scope?: string;
  kickUserId?: string;
};

export type KickUserProfile = {
  kickUserId: string;
  username?: string;
  displayName?: string;
  avatarUrl?: string;
};

export type KickOAuthClient = {
  exchangeAuthorizationCode(input: {
    code: string;
    codeVerifier: string;
    redirectUri: string;
  }): Promise<KickTokenSet & KickUserProfile>;
  refreshAccessToken(input: { refreshToken: string }): Promise<KickTokenSet>;
};

const KICK_TOKEN_URL = "https://id.kick.com/oauth/token";
const KICK_USERS_URL = "https://api.kick.com/public/v1/users";

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function readTokenBody(body: unknown): KickTokenSet {
  const row = asRecord(body);
  const accessToken = row?.access_token;
  if (typeof accessToken !== "string" || accessToken.length === 0) {
    throw new Error("kick token response is missing access_token");
  }
  const expiresIn =
    typeof row?.expires_in === "number" && Number.isFinite(row.expires_in)
      ? row.expires_in
      : 3600;
  return {
    accessToken,
    ...(typeof row?.refresh_token === "string"
      ? { refreshToken: row.refresh_token }
      : {}),
    expiresIn,
    ...(typeof row?.scope === "string" ? { scope: row.scope } : {}),
  };
}

function readOptionalTrimmed(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readKickUserId(body: unknown): string {
  const row = asRecord(body);
  const data = row?.data;
  const first = Array.isArray(data) ? asRecord(data[0]) : asRecord(data);
  const id = first?.user_id ?? first?.id ?? row?.user_id ?? row?.id;
  if (typeof id === "string" && id.length > 0) {
    return id;
  }
  if (typeof id === "number" && Number.isFinite(id)) {
    return String(id);
  }
  throw new Error("kick user id is missing");
}

export function parseKickUserProfile(body: unknown): KickUserProfile {
  const kickUserId = readKickUserId(body);
  const row = asRecord(body);
  const data = row?.data;
  const first = Array.isArray(data) ? asRecord(data[0]) : asRecord(data);
  const source = first ?? row;
  const username =
    readOptionalTrimmed(source?.username) ?? readOptionalTrimmed(source?.name);
  const displayName =
    readOptionalTrimmed(source?.display_name) ??
    readOptionalTrimmed(source?.name) ??
    username;
  const avatarUrl = normalizeHttpsAvatarUrl(
    source?.profile_picture ??
      source?.profilePicture ??
      source?.avatar ??
      source?.avatar_url,
  );
  return {
    kickUserId,
    ...(username ? { username } : {}),
    ...(displayName ? { displayName } : {}),
    ...(avatarUrl ? { avatarUrl } : {}),
  };
}

export function createHttpKickOAuthClient(input: {
  clientId: string;
  clientSecret: string;
  fetchImpl?: typeof fetch;
  /** Finite request timeout in ms (default 15s). */
  timeoutMs?: number;
}): KickOAuthClient {
  const fetchImpl = input.fetchImpl ?? fetch;
  const timeoutMs = input.timeoutMs ?? 15_000;

  async function postToken(params: URLSearchParams): Promise<KickTokenSet> {
    const response = await fetchImpl(KICK_TOKEN_URL, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "user-agent": "AZAROV-GiftBot-V2",
      },
      body: params,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const body: unknown = await response.json().catch(() => undefined);
    if (!response.ok) {
      throw new Error(`kick token endpoint returned ${response.status}`);
    }
    return readTokenBody(body);
  }

  async function fetchKickProfile(accessToken: string): Promise<KickUserProfile> {
    const response = await fetchImpl(KICK_USERS_URL, {
      headers: {
        authorization: `Bearer ${accessToken}`,
        "user-agent": "AZAROV-GiftBot-V2",
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const body: unknown = await response.json().catch(() => undefined);
    if (!response.ok) {
      throw new Error(`kick users endpoint returned ${response.status}`);
    }
    return parseKickUserProfile(body);
  }

  return {
    async exchangeAuthorizationCode(request) {
      const tokens = await postToken(
        new URLSearchParams({
          grant_type: "authorization_code",
          client_id: input.clientId,
          client_secret: input.clientSecret,
          code: request.code,
          redirect_uri: request.redirectUri,
          code_verifier: request.codeVerifier,
        }),
      );
      const profile = await fetchKickProfile(tokens.accessToken);
      return { ...tokens, ...profile };
    },
    async refreshAccessToken(request) {
      return postToken(
        new URLSearchParams({
          grant_type: "refresh_token",
          client_id: input.clientId,
          client_secret: input.clientSecret,
          refresh_token: request.refreshToken,
        }),
      );
    },
  };
}
