const lastKeys = new Map<string, string>();

export function createIdempotencyKey(): string {
  return crypto.randomUUID();
}

export function keyForPost(route: string): string {
  const existing = lastKeys.get(route);
  if (existing) {
    return existing;
  }
  const created = createIdempotencyKey();
  lastKeys.set(route, created);
  return created;
}

export function retryKeyFor(route: string, previous: string): string {
  lastKeys.set(route, previous);
  return previous;
}

export function clearIdempotencyKey(route: string): void {
  lastKeys.delete(route);
}
