# pnkt

Household budget PWA at [pnkt.app](https://pnkt.app). Replaces a spreadsheet that
split shared costs, tracked loans and forecast the joint account balance.

Swedish and English UI, SEK. Code, filenames and docs are English.

```
web/     Vite + React PWA. The calculation engine lives here.
api/     .NET 10 minimal APIs, two Lambdas, DynamoDB.
infra/   CDK (TypeScript), two stacks.
```

## Documentation

| | |
|---|---|
| [docs/model.md](docs/model.md) | What the app computes and the rules behind it |
| [docs/buffer.md](docs/buffer.md) | The buffer: goal, what a good month gives, what it rests on |
| [docs/notifications.md](docs/notifications.md) | Mail, push, schedules and opt-outs |
| [docs/auth.md](docs/auth.md) | Sign-in, roles, and what is deliberately left open |
| [docs/architecture.md](docs/architecture.md) | Layout, AOT, deployment, tests |
| [docs/design.md](docs/design.md) | Why it looks like a ledger |

## Running locally

```
api/scripts/start-local-db.sh           # DynamoDB Local on :8042, creates the table
cd api/src/Budget.Api && dotnet watch    # API on :5080
cd web && npm run dev                    # app on :5173, proxies /api
```

Both halves need the Google client id to allow sign-in:

```
export GOOGLE_CLIENT_ID=...              # api, validates the ID token audience
export VITE_GOOGLE_CLIENT_ID=...         # web, renders the sign-in button
```

Without `SESSION_SECRET_ARN` the API derives a fixed signing key locally, so no AWS
access is needed to run it. That key is deterministic and for development only.

```
cd web && npm run verify                 # engine against the spreadsheet
cd web && npm run e2e                    # browser, API and DynamoDB Local
cd api  && dotnet test Budget.slnx       # session, reminders, push
```

## Differences from the spreadsheet

The sheet applies `ROUNDUP` to each loan's interest, inflating the total by
3.72 kr/month, which is why its two "kvar" figures differ by a krona despite the
rule being an equal split. The engine keeps full precision so both members land on
the same amount. `web/scripts/verify-against-sheet.ts` documents each case.

The sheet also stored costs pre-divided (`13.88888889`), destroying the original
amount and interval. That cannot be recovered and has to be re-entered.

## Next

- Month history snapshots, so past months keep their own figures rather than being
  recomputed from current data.
- Entity versioning, so two people editing the same field are told rather than one
  edit being silently lost.
- Scraper for Länsförsäkringar's published rates, to flag when renegotiating is
  worth it.
