using System.Text;
using System.Text.Encodings.Web;
using Amazon.DynamoDBv2;
using Amazon.Lambda.Serialization.SystemTextJson;
using Amazon.SecretsManager;
using Amazon.SecretsManager.Model;
using Budget.Api;

var builder = WebApplication.CreateSlimBuilder(args);

builder.Services.ConfigureHttpJsonOptions(options =>
{
    options.SerializerOptions.TypeInfoResolverChain.Insert(0, AppJsonContext.Default);
    // Without this every "ö" ships as ö, which is most of a Swedish payload.
    options.SerializerOptions.Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping;
});

// Only active when running under Lambda; a no-op locally. The explicit
// source-generated serializer is required: the default one reflects, which breaks
// under Native AOT at runtime rather than at build time.
builder.Services.AddAWSLambdaHosting(
    LambdaEventSource.HttpApi,
    new SourceGeneratorLambdaJsonSerializer<LambdaJsonContext>());

var tableName = builder.Configuration["TABLE_NAME"] ?? "budget";
var dynamoEndpoint = builder.Configuration["DYNAMODB_ENDPOINT"];
var googleClientId = builder.Configuration["GOOGLE_CLIENT_ID"] ?? "";
var sessionSecretArn = builder.Configuration["SESSION_SECRET_ARN"];

builder.Services.AddSingleton<IAmazonDynamoDB>(_ =>
{
    if (string.IsNullOrWhiteSpace(dynamoEndpoint)) return new AmazonDynamoDBClient();
    return new AmazonDynamoDBClient(
        new Amazon.Runtime.BasicAWSCredentials("local", "local"),
        new AmazonDynamoDBConfig { ServiceURL = dynamoEndpoint, AuthenticationRegion = "eu-north-1" });
});

builder.Services.AddSingleton(sp => new BudgetStore(sp.GetRequiredService<IAmazonDynamoDB>(), tableName));
builder.Services.AddSingleton(new GoogleTokenValidator(new HttpClient(), googleClientId));

// Fetched once during cold start rather than per request. Falls back to a derived
// key locally so `dotnet run` works without any AWS access.
var signingKey = await LoadSigningKeyAsync(sessionSecretArn);
builder.Services.AddSingleton(new SessionTokens(signingKey));

// The deployed app is same-origin behind CloudFront. This is only for `npm run dev`.
builder.Services.AddCors(options =>
    options.AddDefaultPolicy(policy => policy
        .WithOrigins("http://localhost:5173", "http://127.0.0.1:5173")
        .AllowCredentials()
        .AllowAnyHeader()
        .AllowAnyMethod()));

var app = builder.Build();
app.UseCors();

app.MapGet("/api/health", () => TypedResults.Ok(new ErrorResponse("ok")));

/* ---------- Authentication ---------- */

app.MapPost("/api/auth/session", async (
    GoogleSignInRequest request,
    HttpContext ctx,
    GoogleTokenValidator google,
    SessionTokens sessions,
    BudgetStore store,
    CancellationToken ct) =>
{
    var identity = await google.ValidateAsync(request.Credential, ct);
    if (identity is null) return Results.Unauthorized();

    CallerResolver.SetSessionCookie(ctx, sessions, identity.Email);

    var profile = await store.GetProfileAsync(identity.Email, ct);
    return Results.Ok(new MeResponse(true, identity.Email, profile));
});

app.MapPost("/api/auth/signout", (HttpContext ctx) =>
{
    CallerResolver.ClearSessionCookie(ctx);
    return Results.NoContent();
});

app.MapGet("/api/me", async (HttpContext ctx, BudgetStore store, SessionTokens sessions, CancellationToken ct) =>
{
    var caller = await CallerResolver.ResolveAsync(ctx, store, sessions, ct);
    return TypedResults.Ok(new MeResponse(caller.IsSignedIn, caller.Email, caller.Profile));
});

app.MapPost("/api/households", async (
    CreateHouseholdRequest request,
    HttpContext ctx,
    BudgetStore store,
    SessionTokens sessions,
    CancellationToken ct) =>
{
    var caller = await CallerResolver.ResolveAsync(ctx, store, sessions, ct);
    if (!caller.IsSignedIn) return Results.Unauthorized();
    if (caller.HasHousehold)
        return Results.Conflict(new ErrorResponse("Du tillhör redan ett hushåll."));

    var email = caller.Email!;
    var householdId = Guid.NewGuid().ToString();
    var memberId = Guid.NewGuid().ToString();

    var household = new Household(householdId, request.HouseholdName, DateTime.UtcNow.ToString("yyyy-MM"));
    var member = new Member(memberId, request.Name, email, "admin", "active", 0m);

    await store.PutMetaAsync(new BudgetMeta(household, null), ct);
    await store.PutMemberAsync(householdId, member, ct);
    await store.PutProfileAsync(new UserProfile(email, householdId, memberId), ct);

    var budget = await store.GetBudgetAsync(householdId, ct);
    return budget is null
        ? Results.Problem("Hushållet kunde inte läsas tillbaka.")
        : Results.Created("/api/budget", budget);
});

/* ---------- Everything below needs a household ---------- */

var api = app.MapGroup("/api");

api.MapGet("/budget", async (HttpContext ctx, BudgetStore store, SessionTokens sessions, CancellationToken ct) =>
{
    var caller = await CallerResolver.ResolveAsync(ctx, store, sessions, ct);
    if (!caller.HasHousehold) return Results.Unauthorized();

    var budget = await store.GetBudgetAsync(caller.HouseholdId, ct);
    return budget is null ? Results.NotFound(new ErrorResponse("Inget hushåll")) : Results.Ok(budget);
});

api.MapPut("/household", async (
    RenameHouseholdRequest request, HttpContext ctx, BudgetStore store, SessionTokens sessions,
    CancellationToken ct) =>
{
    var caller = await CallerResolver.ResolveAsync(ctx, store, sessions, ct);
    if (!caller.HasHousehold) return Results.Unauthorized();

    var meta = await store.GetMetaAsync(caller.HouseholdId, ct);
    if (meta is null) return Results.NotFound(new ErrorResponse("Inget hushåll"));

    await store.PutMetaAsync(meta with { Household = meta.Household with { Name = request.Name } }, ct);
    return Results.NoContent();
});

api.MapPut("/account-balance", async (
    AccountBalance balance, HttpContext ctx, BudgetStore store, SessionTokens sessions,
    CancellationToken ct) =>
{
    var caller = await CallerResolver.ResolveAsync(ctx, store, sessions, ct);
    if (!caller.HasHousehold) return Results.Unauthorized();

    var meta = await store.GetMetaAsync(caller.HouseholdId, ct);
    if (meta is null) return Results.NotFound(new ErrorResponse("Inget hushåll"));

    await store.PutMetaAsync(meta with { AccountBalance = balance }, ct);
    return Results.NoContent();
});

api.MapPut("/members/{id}", async (string id, Member body, HttpContext ctx, BudgetStore s, SessionTokens t, CancellationToken ct) =>
    await Write(ctx, s, t, ct, h => s.PutMemberAsync(h, body with { Id = id }, ct)));

api.MapDelete("/members/{id}", async (string id, HttpContext ctx, BudgetStore s, SessionTokens t, CancellationToken ct) =>
    await Write(ctx, s, t, ct, h => s.DeleteMemberAsync(h, id, ct)));

api.MapPut("/costs/{id}", async (string id, RecurringCost body, HttpContext ctx, BudgetStore s, SessionTokens t, CancellationToken ct) =>
    await Write(ctx, s, t, ct, h => s.PutCostAsync(h, body with { Id = id }, ct)));

api.MapDelete("/costs/{id}", async (string id, HttpContext ctx, BudgetStore s, SessionTokens t, CancellationToken ct) =>
    await Write(ctx, s, t, ct, h => s.DeleteCostAsync(h, id, ct)));

api.MapPut("/oneoffs/{id}", async (string id, OneOffCost body, HttpContext ctx, BudgetStore s, SessionTokens t, CancellationToken ct) =>
    await Write(ctx, s, t, ct, h => s.PutOneOffAsync(h, body with { Id = id }, ct)));

api.MapDelete("/oneoffs/{id}", async (string id, HttpContext ctx, BudgetStore s, SessionTokens t, CancellationToken ct) =>
    await Write(ctx, s, t, ct, h => s.DeleteOneOffAsync(h, id, ct)));

api.MapPut("/loans/{id}", async (string id, Loan body, HttpContext ctx, BudgetStore s, SessionTokens t, CancellationToken ct) =>
    await Write(ctx, s, t, ct, h => s.PutLoanAsync(h, body with { Id = id }, ct)));

api.MapDelete("/loans/{id}", async (string id, HttpContext ctx, BudgetStore s, SessionTokens t, CancellationToken ct) =>
    await Write(ctx, s, t, ct, h => s.DeleteLoanAsync(h, id, ct)));

api.MapPut("/streams/{id}", async (string id, AmortizationStream body, HttpContext ctx, BudgetStore s, SessionTokens t, CancellationToken ct) =>
    await Write(ctx, s, t, ct, h => s.PutStreamAsync(h, body with { Id = id }, ct)));

api.MapDelete("/streams/{id}", async (string id, HttpContext ctx, BudgetStore s, SessionTokens t, CancellationToken ct) =>
    await Write(ctx, s, t, ct, h => s.DeleteStreamAsync(h, id, ct)));

api.MapPut("/income/{month}/{memberId}", async (
    string month, string memberId, PutIncomeRequest body,
    HttpContext ctx, BudgetStore s, SessionTokens t, CancellationToken ct) =>
    await Write(ctx, s, t, ct, h =>
        s.PutIncomeAsync(h, new IncomeEntry(memberId, month, body.Amount, body.EnteredById), ct)));

api.MapDelete("/income/{month}/{memberId}", async (
    string month, string memberId, HttpContext ctx, BudgetStore s, SessionTokens t, CancellationToken ct) =>
    await Write(ctx, s, t, ct, h => s.DeleteIncomeAsync(h, month, memberId, ct)));

api.MapPut("/dismissals/{month}/{memberId}", async (
    string month, string memberId, HttpContext ctx, BudgetStore s, SessionTokens t, CancellationToken ct) =>
    await Write(ctx, s, t, ct, h => s.PutDismissalAsync(h, new DismissedPrompt(memberId, month), ct)));

api.MapDelete("/dismissals/{month}/{memberId}", async (
    string month, string memberId, HttpContext ctx, BudgetStore s, SessionTokens t, CancellationToken ct) =>
    await Write(ctx, s, t, ct, h => s.DeleteDismissalAsync(h, month, memberId, ct)));

app.Run();
return;

async Task<IResult> Write(
    HttpContext ctx,
    BudgetStore store,
    SessionTokens sessions,
    CancellationToken ct,
    Func<string, Task> action)
{
    var caller = await CallerResolver.ResolveAsync(ctx, store, sessions, ct);
    if (!caller.HasHousehold) return Results.Unauthorized();
    await action(caller.HouseholdId);
    return Results.NoContent();
}

static async Task<byte[]> LoadSigningKeyAsync(string? secretArn)
{
    if (string.IsNullOrWhiteSpace(secretArn))
        return SessionTokens.DevKey("local");

    using var client = new AmazonSecretsManagerClient();
    var response = await client.GetSecretValueAsync(new GetSecretValueRequest { SecretId = secretArn });
    return Encoding.UTF8.GetBytes(response.SecretString);
}
