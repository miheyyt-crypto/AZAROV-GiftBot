export type RateLimitDecision = {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
  resetAt: Date;
};

export type RateLimiter = {
  consume(key: string, now?: Date): Promise<RateLimitDecision>;
};
