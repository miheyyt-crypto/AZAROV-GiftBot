import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";

export function parseTokenEncryptionKey(hex: string): Buffer {
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error("token encryption key must be 64 hex characters");
  }
  return Buffer.from(hex, "hex");
}

export function encryptSecret(key: Buffer, plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64url")}:${tag.toString("base64url")}:${encrypted.toString("base64url")}`;
}

export function decryptSecret(key: Buffer, payload: string): string {
  const parts = payload.split(":");
  if (parts[0] !== "v1" || parts.length !== 4) {
    throw new Error("invalid secret payload");
  }
  const iv = Buffer.from(parts[1] ?? "", "base64url");
  const tag = Buffer.from(parts[2] ?? "", "base64url");
  const encrypted = Buffer.from(parts[3] ?? "", "base64url");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString(
    "utf8",
  );
}
