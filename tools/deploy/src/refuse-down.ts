export function assertNotDownMigration(args: readonly string[]): void {
  for (const arg of args) {
    if (/down/i.test(arg) || arg === "migrate") {
      throw new Error(
        "application rollback is a previous compatible artifact, not a down migration",
      );
    }
  }
}
