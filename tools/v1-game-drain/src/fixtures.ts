export function drainFixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 24,
    users: {
      "1": { telegramId: 1, balance: 1000 },
      "2": { telegramId: 2, balance: 2000 },
    },
    minesGames: {},
    towerGames: {},
    rollRounds: {},
    events: {},
    coinTransactions: {},
    ...overrides,
  };
}
