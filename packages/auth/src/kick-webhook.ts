import { constants, createPublicKey, verify } from "node:crypto";

export const KICK_PUBLIC_KEY_URL = "https://api.kick.com/public/v1/public-key";

export type KickEventSignatureInput = {
  messageId: string;
  timestamp: string;
  rawBody: Buffer;
  signature: string;
  publicKeyPem: string;
};

export function buildKickSignedMessage(
  messageId: string,
  timestamp: string,
  rawBody: Buffer,
): Buffer {
  return Buffer.concat([
    Buffer.from(messageId, "utf8"),
    Buffer.from("."),
    Buffer.from(timestamp, "utf8"),
    Buffer.from("."),
    rawBody,
  ]);
}

function decodeStdBase64(value: string): Buffer | undefined {
  if (!value || !/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 !== 0) {
    return undefined;
  }
  const decoded = Buffer.from(value, "base64");
  if (decoded.toString("base64") !== value) {
    return undefined;
  }
  return decoded;
}

export function verifyKickEventSignature(
  input: KickEventSignatureInput,
): boolean {
  if (!input.messageId || !input.timestamp || !input.signature) {
    return false;
  }
  const signature = decodeStdBase64(input.signature);
  if (!signature || signature.length === 0) {
    return false;
  }
  try {
    const key = createPublicKey(input.publicKeyPem);
    return verify(
      "sha256",
      buildKickSignedMessage(input.messageId, input.timestamp, input.rawBody),
      {
        key,
        padding: constants.RSA_PKCS1_PADDING,
      },
      signature,
    );
  } catch {
    return false;
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

export async function fetchKickPublicKeyPem(
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const response = await fetchImpl(KICK_PUBLIC_KEY_URL);
  if (!response.ok) {
    throw new Error(`kick public key endpoint returned ${response.status}`);
  }
  const body: unknown = await response.json();
  const pem = asRecord(asRecord(body)?.data)?.public_key;
  if (typeof pem !== "string" || pem.length === 0) {
    throw new Error("kick public key response is missing public_key");
  }
  return pem;
}

export function createKickPublicKeyResolver(options: {
  publicKeyPem?: string;
  fetchImpl?: typeof fetch;
} = {}): () => Promise<string> {
  if (options.publicKeyPem !== undefined) {
    const pem = options.publicKeyPem;
    return async () => pem;
  }
  const fetchImpl = options.fetchImpl ?? fetch;
  let cached: string | undefined;
  let inflight: Promise<string> | undefined;
  return async () => {
    if (cached !== undefined) {
      return cached;
    }
    if (inflight === undefined) {
      inflight = fetchKickPublicKeyPem(fetchImpl)
        .then((pem) => {
          cached = pem;
          return pem;
        })
        .finally(() => {
          inflight = undefined;
        });
    }
    return inflight;
  };
}
