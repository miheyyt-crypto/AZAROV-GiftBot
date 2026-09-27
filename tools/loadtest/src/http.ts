export type TimedResponse = {
  status: number;
  ms: number;
  ok: boolean;
  text: string;
};

export async function timedRequest(
  url: string,
  init: RequestInit,
): Promise<TimedResponse> {
  const started = performance.now();
  try {
    const response = await fetch(url, init);
    const text = await response.text();
    const ms = performance.now() - started;
    return {
      status: response.status,
      ms,
      ok: response.ok,
      text,
    };
  } catch {
    return {
      status: 0,
      ms: performance.now() - started,
      ok: false,
      text: "",
    };
  }
}

export async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function run(): Promise<void> {
    while (next < items.length) {
      const index = next;
      next += 1;
      const item = items[index];
      if (item === undefined) {
        return;
      }
      results[index] = await worker(item, index);
    }
  }
  const runners = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => run(),
  );
  await Promise.all(runners);
  return results;
}
