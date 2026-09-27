/**
 * Guard for async boot results under React StrictMode double-invoke.
 * Without this, an older /auth (or /dev/auth) that rotated sessions can
 * overwrite the newer token with a revoked one.
 */
export function createBootGenerationGuard(): {
  next: () => number;
  isCurrent: (generation: number) => boolean;
  cancel: () => void;
} {
  let current = 0;
  return {
    next(): number {
      current += 1;
      return current;
    },
    isCurrent(generation: number): boolean {
      return generation === current;
    },
    cancel(): void {
      current += 1;
    },
  };
}
