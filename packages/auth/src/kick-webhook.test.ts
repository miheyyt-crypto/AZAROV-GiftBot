import assert from "node:assert/strict";
import {
  constants,
  generateKeyPairSync,
  sign,
} from "node:crypto";
import { test } from "node:test";
import {
  KICK_PUBLIC_KEY_URL,
  buildKickSignedMessage,
  createKickPublicKeyResolver,
  verifyKickEventSignature,
} from "./kick-webhook.js";

const { publicKey, privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

const otherKey = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

function signKick(
  messageId: string,
  timestamp: string,
  rawBody: Buffer,
  key = privateKey,
): string {
  return sign("sha256", buildKickSignedMessage(messageId, timestamp, rawBody), {
    key,
    padding: constants.RSA_PKCS1_PADDING,
  }).toString("base64");
}

const messageId = "01JEVENTMESSAGEID0000000000";
const timestamp = "2026-09-13T14:30:00Z";
const rawBody = Buffer.from('{"hello":true}', "utf8");

test("accepts a valid Kick Events RSA signature", () => {
  assert.equal(
    verifyKickEventSignature({
      messageId,
      timestamp,
      rawBody,
      signature: signKick(messageId, timestamp, rawBody),
      publicKeyPem: publicKey,
    }),
    true,
  );
});

test("rejects an invalid signature", () => {
  assert.equal(
    verifyKickEventSignature({
      messageId,
      timestamp,
      rawBody,
      signature: signKick(messageId, timestamp, rawBody, otherKey.privateKey),
      publicKeyPem: publicKey,
    }),
    false,
  );
});

test("rejects a missing signature", () => {
  assert.equal(
    verifyKickEventSignature({
      messageId,
      timestamp,
      rawBody,
      signature: "",
      publicKeyPem: publicKey,
    }),
    false,
  );
});

test("rejects a changed raw body", () => {
  const signature = signKick(messageId, timestamp, rawBody);
  assert.equal(
    verifyKickEventSignature({
      messageId,
      timestamp,
      rawBody: Buffer.from('{"hello":false}', "utf8"),
      signature,
      publicKeyPem: publicKey,
    }),
    false,
  );
});

test("rejects a changed message ID", () => {
  const signature = signKick(messageId, timestamp, rawBody);
  assert.equal(
    verifyKickEventSignature({
      messageId: "01JEVENTMESSAGEIDCHANGED0000",
      timestamp,
      rawBody,
      signature,
      publicKeyPem: publicKey,
    }),
    false,
  );
});

test("rejects a changed timestamp", () => {
  const signature = signKick(messageId, timestamp, rawBody);
  assert.equal(
    verifyKickEventSignature({
      messageId,
      timestamp: "2020-01-01T00:00:00Z",
      rawBody,
      signature,
      publicKeyPem: publicKey,
    }),
    false,
  );
});

test("rejects malformed base64", () => {
  assert.equal(
    verifyKickEventSignature({
      messageId,
      timestamp,
      rawBody,
      signature: "not-valid-base64!!!",
      publicKeyPem: publicKey,
    }),
    false,
  );
});

test("resolver uses an injected public key without HTTP", async () => {
  const resolve = createKickPublicKeyResolver({ publicKeyPem: publicKey });
  assert.equal(await resolve(), publicKey);
});

test("resolver fetches the documented public key once and caches it", async () => {
  let calls = 0;
  const resolve = createKickPublicKeyResolver({
    fetchImpl: async (input) => {
      calls += 1;
      assert.equal(String(input), KICK_PUBLIC_KEY_URL);
      return new Response(
        JSON.stringify({ data: { public_key: publicKey }, message: "ok" }),
        { status: 200 },
      );
    },
  });
  assert.equal(await resolve(), publicKey);
  assert.equal(await resolve(), publicKey);
  assert.equal(calls, 1);
});
