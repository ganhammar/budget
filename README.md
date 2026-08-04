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

Live in eu-north-1, deployed by CI. Google sign-in is in place and the API rejects
anything without a valid session cookie.

## Running locally

```
api/scripts/start-local-db.sh          # DynamoDB Local on :8042, creates the table
cd api/src/Budget.Api && dotnet watch   # API on :5080
cd web && npm run dev                   # app on :5173, proxies /api
```

Both halves need the Google client id to allow sign-in:

```
export GOOGLE_CLIENT_ID=...              # api, validates the ID token audience
export VITE_GOOGLE_CLIENT_ID=...         # web, renders the sign-in button
```

Without `SESSION_SECRET_ARN` the API derives a fixed signing key locally, so no AWS
access is needed to run it. That key is deterministic and for development only.

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
banner that appears from the 8th of each month and asks the signed-in member about
their own income only. Admins can fill in on someone else's behalf. The presence of
an `IncomeEntry` is what marks a month as confirmed; a month with no entry falls
back to the baseline and is shown as an estimate.

Closing the banner lasts for the session only. It used to be persisted per member
per month, which meant one stray tap silenced the prompt until the next month.

**The split** equalises what each member has left over rather than splitting
proportionally by income:

```
surplusPerMember = (totalIncome − totalCosts) / activeMembers
toTransfer       = income − paidDirectly − surplusPerMember
```

Anything tagged with a `payerId` is paid directly by that member and deducted from
their transfer to the joint account. It does not change the split itself.

## Authentication

Google Identity Services hands the browser an ID token. That token is posted once
to `/api/auth/session`, validated against Google's JWKS, and exchanged for our own
HMAC-signed session cookie. Google is never consulted again.

The exchange exists because Google ID tokens last an hour and a browser cannot hold
a refresh token safely. Re-prompting hourly on a phone would be unusable, so the
session cookie carries 30 days instead.

The cookie is `httpOnly; Secure; SameSite=Lax`, which is enough because the app and
the API are same-origin behind CloudFront. Its signing key is generated into Secrets
Manager and read once per cold start.

**Authentication and authorization are separate.** A verified Google account with no
membership row gets a 401 and the create-household screen. That is why the OAuth
consent screen can be published without exposing anything: access is decided by the
household member list, not by who Google will vouch for.

## Email

Sent through SES from `budget@ganhammar.se`, on a domain verified with DKIM.
Permission is scoped to that one identity rather than `ses:SendEmail` on everything.

**Invites** go out when a member row is first written, and only then, so editing
someone later does not mail them again. The link carries no token: the household
member list is what grants access, and the recipient still has to sign in with
Google as that address.

**Income reminders** run on the 22nd, 25th and 27th at 08:00, pinned to
Europe/Stockholm. EventBridge Rules cannot express a timezone, only Scheduler can,
and without it the dates drift an hour twice a year. Each run emails the active
members with no confirmed figure for that month, so confirming stops your own
reminders without affecting anyone else's. The 27th is worded as the last one.

Reminders ignore the in-app banner entirely. Closing a banner is a UI convenience,
not a statement that the figure is handled.

## Design

Ledger, not dashboard. The app descends from a spreadsheet and its job is columns
of figures that have to be read exactly, so the layout is hairlines and vertical
rhythm rather than cards: amounts sit in a right-aligned tabular column, a serif
carries labels and names, and red is reserved for negatives the way a paper ledger
uses red ink.

**Charts are grey lines with a dot per month**, not filled areas or coloured
series. Each line is labelled at its right end, so identity comes from the name
rather than the shade, which also means colourblindness cannot make two loans
indistinguishable. The ink ramp exists only to keep neighbouring lines apart and
was validated as an ordinal ramp against both papers: monotone lightness, visible
step gaps, and the lightest step clearing the surface.

A loan that has already cleared is not labelled on the chart, since it sits flat on
zero where a label would collide with the axis and repeat what the legend says.

## Architecture notes

**Two Lambdas: the API and the reminder job.** Still not one per endpoint. The API
is a single function serving every route; the scheduled job is a genuinely
different workload and cannot share an entry point, since the ASP.NET Core host
only understands HTTP events. `Budget.Core` holds the models, DynamoDB access and
income rules that both need, so "confirmed income" has one definition.

**One Lambda for the whole API.** ASP.NET Core minimal APIs with
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
(`ubuntu-24.04-arm`) produces the real artifact; `api/scripts/publish.sh` falls back
to a trimmed self-contained build on any other host, which deploys identically but
starts slower. **Deploy through CI, not from a laptop**, or the fallback overwrites
the AOT build.

Measured on the deployed function:

| | trimmed fallback | Native AOT |
|---|---|---|
| Init duration | 1247 ms | 276 ms |
| Warm execution | 31 ms | 1.4 ms |
| Artifact | 30 MB | 22 MB |

Roughly 100 ms of that init is the Secrets Manager fetch for the session signing
key, which happens before the first request is served.

CI is the only thing that proves the AOT build works, since reflection and missing
serializer contexts fail at runtime rather than during `dotnet run`.

## Deployment

Pushing to `main` runs three jobs: `api` builds the AOT artifact, `web` verifies the
engine and builds, then `deploy` assumes an AWS role through GitHub's OIDC provider
and runs `cdk deploy`.

The account's existing `GithubDeploy` role is used, with this repository added to
its trust policy allow-list. That list is pinned to `refs/heads/main` for this repo
rather than a wildcard, because the repository is public and any wildcard subject
would let an arbitrary pull request assume the role.

Repository variables the workflow reads:

| Variable | Purpose |
|---|---|
| `AWS_ROLE_ARN` | Role assumed via OIDC |
| `AWS_REGION` | `eu-north-1` |
| `VITE_GOOGLE_CLIENT_ID` | Google client id, for both the web build and the Lambda |

Artifacts do not preserve file modes, so the deploy job restores the executable bit
on `bootstrap` after downloading it. `provided.al2023` will not run it otherwise.

## Differences from the spreadsheet

The sheet applies `ROUNDUP` to each loan's interest, inflating the total by
3.72 kr/month, which is why its two "kvar" figures differ by a krona despite the
rule being an equal split. The engine keeps full precision so both members land on
the same amount. `web/scripts/verify-against-sheet.ts` documents each case.

The sheet also stored costs pre-divided (`13.88888889`), destroying the original
amount and interval. That cannot be recovered and has to be re-entered.

## Next

- Custom domain `budget.ganhammar.se`. The ACM certificate exists in us-east-1;
  DNS lives in Cloudflare, so validation and the alias record are manual steps.
- Month history snapshots, so past months keep their own figures rather than being
  recomputed from current data.
- Scraper for Länsförsäkringar's published list and average rates, to compare
  against your own rate and flag when renegotiating is worth it.
