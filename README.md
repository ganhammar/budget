# Budget

Household budget PWA. Replaces a spreadsheet that split shared costs, tracked loans
and forecast the joint account balance.

Swedish UI, SEK. Code, filenames and docs are English.

## Layout

```
web/     Vite + React PWA. The calculation engine lives here.
api/     .NET 10 minimal API, one Lambda, DynamoDB.
infra/   CDK (TypeScript).
```

## Status

Deployed to eu-north-1. **Authentication is mocked**: the caller is whatever email
arrives in the `X-Budget-User` header, falling back to `DEV_EMAIL`. The API is
therefore effectively open, so do not put real figures in it until Google sign-in
lands.

## Running locally

```
api/scripts/start-local-db.sh                       # DynamoDB Local + table
cd api/src/Budget.Api && dotnet watch                # API on :5080
cd web && npm run dev                                # app on :5173, proxies /api
```

`cd web && npm run verify` checks the calculation engine against the numbers from
the original spreadsheet.

## Model

**Recurring costs** carry `amount` plus `intervalMonths` plus a `firstCharge`
anchor, so "6 000 kr every 6 months from December" keeps its shape. Two figures
fall out of that, used for different things:

- **Budgeted monthly** (`amount / intervalMonths`) drives the split between
  members. It has to stay stable, since nobody's contribution should jump because
  the car insurance happens to land in June.
- **Actual cash flow** is the real charge in the months it hits, and drives the
  joint account forecast.

**One-off costs** are short-term loans from the household to itself. The full
amount leaves the joint account at `start`; the monthly share is then collected as
an obligation until `end`, so the account dips and recovers to net zero.

**Loans** hold a nominal rate; monthly interest is `debt × nominalRate / 12`. The
effective rate (`(1 + r/12)^12 - 1`) is shown for comparison only and never used
for the monthly charge, because dividing an effective rate by 12 double-counts
compounding. Debt is derived rather than stored: original debt minus amortization
applied since the stream start.

**Amortization streams** are separate from loans. `parallel` splits the amount
evenly across its loans; `priority` clears them in order and rolls the whole amount
onto the next once one is settled.

**Income** has one standing baseline per member. Actual figures are collected by a
banner that appears from the 8th of each month, asks the signed-in member about
their own income only, and stays closed once answered or dismissed. Admins can fill
in on someone else's behalf. The presence of an `IncomeEntry` is what marks a month
as confirmed; a month with no entry falls back to the baseline and is shown as an
estimate.

**The split** equalises what each member has left over rather than splitting
proportionally by income:

```
surplusPerMember = (totalIncome − totalCosts) / activeMembers
toTransfer       = income − paidDirectly − surplusPerMember
```

Anything tagged with a `payerId` is paid directly by that member and deducted from
their transfer to the joint account. It does not change the split itself.

## Architecture notes

**One Lambda, not one per endpoint.** ASP.NET Core minimal APIs with
`AddAWSLambdaHosting`. Controllers are deliberately not used: they are not Native
AOT compatible. Serialization goes through source-generated contexts for the same
reason, including `LambdaJsonContext` for the invocation envelope, without which
the app compiles cleanly and then fails at runtime under AOT.

**API Gateway HTTP API rather than a Lambda function URL.** A function URL behind
CloudFront OAC looks cheaper and simpler, but OAC signs the request without the
body, so every POST and PUT fails SigV4 validation with a 403. HTTP API has no such
problem and costs roughly a dollar per million requests.

**Single DynamoDB table.** Everything for a household shares a partition key, so
the whole budget loads in one query. Entities are stored as JSON in a `data`
attribute; the only write pattern is replacing a whole entity, so exploding them
into typed attributes would buy nothing.

**The web store diffs.** Components mutate the whole budget object, and
`store/sync.ts` compares before and after to derive the per-entity API calls. That
keeps the component ergonomics without threading save calls through every screen.

**No SPA error-page fallback on CloudFront.** The app routes on the hash, and a
distribution-wide 403/404 rewrite would silently turn genuine API errors into a
200 page of HTML.

## Native AOT

The published artifact is a zip on `provided.al2023` / arm64, with the executable
named `bootstrap`.

Native AOT cannot cross-compile, so it only builds on linux-arm64. CI
(`ubuntu-24.04-arm`) produces the real AOT artifact; `api/scripts/publish.sh`
falls back to a trimmed self-contained build on any other host, which deploys
identically but starts slower. **The currently deployed function is the fallback**,
with a cold start around 1.2s. AOT should bring that to roughly 150-250ms.

CI is the only thing that proves the AOT build works, since reflection and missing
serializer contexts fail at runtime rather than during `dotnet run`.

## Differences from the spreadsheet

The sheet applies `ROUNDUP` to each loan's interest, inflating the total by
3.72 kr/month, which is why its two "kvar" figures differ by a krona despite the
rule being an equal split. The engine keeps full precision so both members land on
the same amount. `web/scripts/verify-against-sheet.ts` documents each case.

The sheet also stored costs pre-divided (`13.88888889`), destroying the original
amount and interval. That cannot be recovered and has to be re-entered.

## Next

- Google sign-in exchanged once for a session JWT in an httpOnly cookie, replacing
  `CallerResolver`. Everything else keeps working against the same shape.
- An OIDC role for GitHub so CI can deploy the AOT artifact.
- Month history snapshots.
- Scraper for Länsförsäkringar's published list and average rates.
