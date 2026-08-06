using System.Text;
using System.Text.Encodings.Web;
using Amazon.DynamoDBv2;
using Amazon.Lambda.Serialization.SystemTextJson;
using Amazon.SecretsManager;
using Amazon.SecretsManager.Model;
using Amazon.SimpleEmailV2;
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
var fromAddress = builder.Configuration["FROM_ADDRESS"] ?? "budget@ganhammar.se";
var appUrl = builder.Configuration["APP_URL"] ?? "https://budget.ganhammar.se";
var emailEnabled = builder.Configuration["EMAIL_ENABLED"] != "false";

builder.Services.AddSingleton<IAmazonDynamoDB>(_ =>
{
    if (string.IsNullOrWhiteSpace(dynamoEndpoint)) return new AmazonDynamoDBClient();
    return new AmazonDynamoDBClient(
        new Amazon.Runtime.BasicAWSCredentials("local", "local"),
        new AmazonDynamoDBConfig { ServiceURL = dynamoEndpoint, AuthenticationRegion = "eu-north-1" });
});

builder.Services.AddSingleton(sp => new BudgetStore(sp.GetRequiredService<IAmazonDynamoDB>(), tableName));
builder.Services.AddSingleton(new GoogleTokenValidator(new HttpClient(), googleClientId));
builder.Services.AddSingleton(new EmailSender(
    new AmazonSimpleEmailServiceV2Client(), fromAddress, appUrl));

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

    // Activation happens in CallerResolver, so it also covers anyone invited while
    // already holding a session.
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

    var budget = await store.GetBudgetAsync(householdId, memberId, ct);
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

    var budget = await store.GetBudgetAsync(caller.HouseholdId, caller.Member?.Id, ct);
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

// Kept to a sane size and shape here rather than trusting the client: these end up
// as labels on every cost row.
api.MapPut("/household/categories", async (
    CategoriesRequest request, HttpContext ctx, BudgetStore store, SessionTokens sessions,
    CancellationToken ct) =>
{
    var caller = await CallerResolver.ResolveAsync(ctx, store, sessions, ct);
    if (!caller.HasHousehold) return Results.Unauthorized();

    var meta = await store.GetMetaAsync(caller.HouseholdId, ct);
    if (meta is null) return Results.NotFound(new ErrorResponse("Inget hushåll"));

    var cleaned = request.Categories
        .Select(c => c.Trim())
        .Where(c => c.Length is > 0 and <= 40)
        .Distinct(StringComparer.OrdinalIgnoreCase)
        .Take(50)
        .ToList();

    await store.PutMetaAsync(
        meta with { Household = meta.Household with { Categories = cleaned } }, ct);
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

// Members are the one collection with a side effect: the email has to be mapped to
// the household, or an invited person signs in successfully and finds nothing.
api.MapPut("/members/{id}", async (
    string id, Member body, HttpContext ctx, BudgetStore s, SessionTokens t,
    EmailSender mail, CancellationToken ct) =>
{
    var caller = await CallerResolver.ResolveAsync(ctx, s, t, ct);
    if (!caller.HasHousehold) return Results.Unauthorized();

    var member = body with { Id = id };
    var existing = await s.GetProfileAsync(member.Email, ct);

    if (existing is not null && existing.HouseholdId != caller.HouseholdId)
        return Results.Conflict(new ErrorResponse("Adressen tillhör redan ett annat hushåll."));

    var isNew = existing is null;
    await s.PutMemberAsync(caller.HouseholdId, member, ct);

    if (isNew)
    {
        await s.PutProfileAsync(new UserProfile(member.Email, caller.HouseholdId, id), ct);

        // Only on the first write, so editing a member later does not re-invite them.
        if (emailEnabled && member.Status == "invited")
        {
            var meta = await s.GetMetaAsync(caller.HouseholdId, ct);
            var invite = Messages.Invite(
                meta?.Household.Name ?? "hushållet",
                caller.Member?.Name ?? "Någon",
                mail.AppUrl,
                member.Language);
            try
            {
                await mail.SendAsync(member.Email, invite.Subject, invite.Body, ct);
            }
            catch (Exception ex)
            {
                // The member is already saved; failing the request would be worse.
                app.Logger.LogError(ex, "Could not send invite to {Email}", member.Email);
            }
        }
    }

    return Results.NoContent();
});

// Sending is the whole point here, so unlike the write above a failure is reported
// rather than logged: the caller asked for a mail and needs to know it did not go.
api.MapPost("/members/{id}/invite", async (
    string id, HttpContext ctx, BudgetStore s, SessionTokens t,
    EmailSender mail, CancellationToken ct) =>
{
    var caller = await CallerResolver.ResolveAsync(ctx, s, t, ct);
    if (!caller.HasHousehold) return Results.Unauthorized();
    // ErrorResponse rather than Results.Problem: ProblemDetails is not in the
    // source-generated context, so it compiles and then throws under AOT.
    if (!emailEnabled)
        return Results.Json(new ErrorResponse("E-post är avstängt i den här miljön."), statusCode: 503);

    var member = await s.GetMemberAsync(caller.HouseholdId, id, ct);
    if (member is null) return Results.NotFound(new ErrorResponse("Medlemmen finns inte."));

    // An invite that leads nowhere is worse than none, so make sure the address is
    // mapped to this household before pointing someone at the sign-in.
    var existing = await s.GetProfileAsync(member.Email, ct);
    if (existing is null)
        await s.PutProfileAsync(new UserProfile(member.Email, caller.HouseholdId, id), ct);
    else if (existing.HouseholdId != caller.HouseholdId)
        return Results.Conflict(new ErrorResponse("Adressen tillhör redan ett annat hushåll."));

    var meta = await s.GetMetaAsync(caller.HouseholdId, ct);
    var invite = Messages.Invite(
        meta?.Household.Name ?? "hushållet",
        caller.Member?.Name ?? "Någon",
        mail.AppUrl,
        member.Language);

    try
    {
        await mail.SendAsync(member.Email, invite.Subject, invite.Body, ct);
    }
    catch (Exception ex)
    {
        app.Logger.LogError(ex, "Could not send invite to {Email}", member.Email);
        return Results.Json(new ErrorResponse("Inbjudan kunde inte skickas."), statusCode: 502);
    }

    return Results.NoContent();
});

api.MapDelete("/members/{id}", async (
    string id, HttpContext ctx, BudgetStore s, SessionTokens t, CancellationToken ct) =>
{
    var caller = await CallerResolver.ResolveAsync(ctx, s, t, ct);
    if (!caller.HasHousehold) return Results.Unauthorized();

    // The profile has to go too, or a removed member can still sign back in.
    var member = await s.GetMemberAsync(caller.HouseholdId, id, ct);
    if (member is not null) await s.DeleteProfileAsync(member.Email, ct);

    await s.DeleteMemberAsync(caller.HouseholdId, id, ct);
    return Results.NoContent();
});

// Private to the member. The body's MemberId is ignored in favour of the caller's,
// so nobody can write into someone else's savings by editing a payload.
api.MapPut("/savings/{id}", async (
    string id, Saving body, HttpContext ctx, BudgetStore s, SessionTokens t, CancellationToken ct) =>
{
    var caller = await CallerResolver.ResolveAsync(ctx, s, t, ct);
    if (!caller.HasHousehold || caller.Member is null) return Results.Unauthorized();

    await s.PutSavingAsync(
        caller.HouseholdId, body with { Id = id, MemberId = caller.Member.Id }, ct);
    return Results.NoContent();
});

api.MapDelete("/savings/{id}", async (
    string id, HttpContext ctx, BudgetStore s, SessionTokens t, CancellationToken ct) =>
{
    var caller = await CallerResolver.ResolveAsync(ctx, s, t, ct);
    if (!caller.HasHousehold || caller.Member is null) return Results.Unauthorized();

    await s.DeleteSavingAsync(caller.HouseholdId, caller.Member.Id, id, ct);
    return Results.NoContent();
});

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
