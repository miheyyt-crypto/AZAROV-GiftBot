/** Temporary boot diagnostics — correlate client timestamps with Railway session logs. */
export function sessionBootLog(event: string, data?: Record<string, unknown>): void {
  try {
    console.info(`[SESSION] ${Date.now()} ${event}`, data ?? '')
  } catch {
    // ignore
  }
}
