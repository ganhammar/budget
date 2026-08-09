# Architecture

```
web/     Vite + React PWA. The calculation engine lives here.
api/     .NET 10 minimal APIs, two Lambdas, DynamoDB.
infra/   CDK (TypeScript), two stacks.
```

**Two Lambdas: the API and the scheduled job.** Not one per endpoint. The API is a
single function serving every route; the job is a different workload and cannot
share an entry point, since the ASP.NET Core host only understands HTTP events.
`Budget.Core` holds the models, storage and income rules both need, so "confirmed
income" has one definition.

**The engine lives in the browser.** Every figure is derived from the whole budget,
which loads in one query, so there is nothing for a server round trip to add.

**API Gateway HTTP API rather than a Lambda function URL.** A function URL behind
CloudFront OAC looks simpler, but OAC signs the request without the body, so every
POST and PUT fails SigV4 validation with a 403.

**Single DynamoDB table.** Everything for a household shares a partition key.
Entities are stored as JSON in a `data` attribute; the only write pattern is
replacing a whole entity, so typed attributes would buy nothing.

**The web store diffs.** Components mutate the whole budget object and
`store/sync.ts` compares before and after to derive the per-entity calls. Writes are
optimistic; a failed one reloads, and the budget is re-read whenever the app is
looked at again, because a tab left open holds a snapshot that would otherwise
overwrite everything that arrived since.

**Two distributions.** `pnkt.app` serves the app; `budget.ganhammar.se` redirects to
it. A distribution carries one certificate, and the old domain's DNS is not managed
here, so its certificate cannot be reissued from CDK.

**DNS is at Cloudflare** for both domains, because the registrar is Cloudflare and
it offers no custom nameservers. Certificate validation records, the apex and www
CNAMEs and the DKIM records are all added there by hand. Nothing in CDK writes DNS.

**No SPA error-page fallback on CloudFront.** The app routes on the hash, and a
distribution-wide rewrite would turn genuine API errors into a 200 page of HTML.

## Native AOT

The artifact is a zip on `provided.al2023` / arm64 with the executable named
`bootstrap`. Controllers are not used and serialization goes through
source-generated contexts, both because reflection breaks under AOT at runtime
rather than at build time.

Native AOT cannot cross-compile, so it only builds on linux-arm64. CI produces the
real artifact; `api/scripts/publish.sh` falls back to a trimmed self-contained build
elsewhere, which deploys identically but starts slower. **Deploy through CI**, or
the fallback overwrites the AOT build.

| | trimmed fallback | Native AOT |
|---|---|---|
| Init duration | 1247 ms | 276 ms |
| Warm execution | 31 ms | 1.4 ms |
| Artifact | 30 MB | 22 MB |

Two failure modes this has actually produced, both invisible until the endpoint is
called: `Results.Problem` throws because `ProblemDetails` is not in the context, and
an unregistered service taken as a minimal API parameter is read as a JSON body and
takes down every route in its group. Every error goes through one helper naming
`AppJsonContext.Default.ErrorResponse`, and optional services are bound with
`[FromServices]`.

## Deployment

Pushing to `main` runs `api`, `web`, `test` and `e2e`; all four gate `deploy`, which
assumes a role through GitHub's OIDC provider and runs `cdk deploy --all`.

The trust policy is pinned to `refs/heads/main` rather than a wildcard, because the
repository is public and a wildcard subject would let any pull request assume the
role.

| Variable | Purpose |
|---|---|
| `AWS_ROLE_ARN` | Role assumed via OIDC |
| `AWS_REGION` | `eu-north-1` |
| `VITE_GOOGLE_CLIENT_ID` | Google client id, for the web build and the Lambda |

Artifacts do not preserve file modes, so the deploy job restores the executable bit
on `bootstrap`. `provided.al2023` will not run it otherwise.

Hashed assets are cached for a year and `index.html` never, and nothing is pruned:
a browser holding an older page still asks for the bundles that page named.

## Tests

`npm run verify` checks the engine against the original spreadsheet, and against
every rule since that the sheet never had. `dotnet test` covers the session cookie,
the reminder rules and the push framing. `npm run e2e` drives a browser against the
dev server, its proxy, the API and DynamoDB Local, including a session minted the
way the API signs one locally.

Sign-in itself ends at Google and cannot be automated. Everything behind it can.
