export type DevLocalRole = "user" | "admin";

/** Only explicit `user` / `admin`. Invalid values grant nothing. */
export function readDevRoleFromSearch(search: string): DevLocalRole | undefined {
  const raw = new URLSearchParams(search).get("dev");
  if (raw === "user") {
    return "user";
  }
  if (raw === "admin") {
    return "admin";
  }
  return undefined;
}
