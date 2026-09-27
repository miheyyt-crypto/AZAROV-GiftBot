# V1 importer (Phase 15)

Isolated one-way tool. It is not a runtime process and not a Mini App/API route.

V1 is read-only: you pass a `giftbot-v1-export` JSON file. `store.json` is not a V2 store and is not copied into PostgreSQL as a blob.

## Export contract

```json
{
  "format": "giftbot-v1-export",
  "version": 1,
  "users": [
    {
      "telegram_user_id": "123",
      "first_name": "Ada",
      "balance_minor": 400,
      "legacy_id": "optional",
      "ledger": [
        { "legacy_tx_id": "tx-1", "type": "deposit", "amount_minor": 500 },
        { "legacy_tx_id": "tx-2", "type": "bet", "amount_minor": -100 }
      ]
    }
  ]
}
```

Amounts are integer minor units already. This tool does not invent a currency scale.

## Modes

- `snapshot` (default): `opening_balance_minor = balance_minor` and `balance_minor = imported` (plus any later V2 ledger). No V1 history rows.
- `full_history`: `opening_balance_minor = 0`; each ledger row is `Wallet.apply` with `import:v1:{legacy_tx_id}`. Ledger sum must equal `balance_minor`.

Do not use both for the same amounts.

## Commands

```text
npm exec --yes -- pnpm@10.15.1 --filter @giftbot/v1-importer start -- --file ./export.json --dry-run
npm exec --yes -- pnpm@10.15.1 --filter @giftbot/v1-importer start -- --file ./export.json --mode snapshot
npm exec --yes -- pnpm@10.15.1 --filter @giftbot/v1-importer start -- --file ./export.json --mode full_history
```

Dry-run writes nothing. Apply requires `DATABASE_URL` and a migrated V2 database. Reruns are idempotent.
