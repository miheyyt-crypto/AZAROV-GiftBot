const REDACTED = "[REDACTED]";

const SECRET_KEY =
  /^(authorization|cookie|set-cookie|token|access_token|refresh_token|id_token|initdata|init_data|password|passwd|secret|client_secret|encryption_key|api[_-]?key|bearer|x-telegram-bot-api-secret-token|kick-event-signature)$/i;

export function isSecretKey(key: string): boolean {
  return SECRET_KEY.test(key);
}

export function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactSecrets(item));
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = isSecretKey(key) ? REDACTED : redactSecrets(item);
    }
    return out;
  }
  return value;
}
