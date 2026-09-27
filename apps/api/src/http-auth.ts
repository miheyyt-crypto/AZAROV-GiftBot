import { SessionUnauthorizedError } from "@giftbot/auth";

export function readBearer(header: string | undefined): string {
  if (!header) {
    throw new SessionUnauthorizedError();
  }
  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token) {
    throw new SessionUnauthorizedError();
  }
  return token;
}
