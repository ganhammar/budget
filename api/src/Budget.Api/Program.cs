using System.Text.Encodings.Web;
using Amazon.DynamoDBv2;
using Amazon.Lambda.Serialization.SystemTextJson;
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
var devEmail = builder.Configuration["DEV_EMAIL"] ?? "ganhammar@gmail.com";

builder.Services.AddSingleton<IAmazonDynamoDB>(_ =>
{
    if (string.IsNullOrWhiteSpace(dynamoEndpoint)) return new AmazonDynamoDBClient();
    return new AmazonDynamoDBClient(
        new Amazon.Runtime.BasicAWSCredentials("local", "local"),
        new AmazonDynamoDBConfig { ServiceURL = dynamoEndpoint, AuthenticationRegion = "eu-north-1" });
});

builder.Services.AddSingleton(sp => new BudgetStore(sp.GetRequiredService<IAmazonDynamoDB>(), tableName));

// The deployed app is same-origin behind CloudFront. This is only for `npm run dev`.
builder.Services.AddCors(options =>
    options.AddDefaultPolicy(policy => policy
        .WithOrigins("http://localhost:5173", "http://127.0.0.1:5173")
        .AllowAnyHeader()
        .AllowAnyMethod()));

var app = builder.Build();
app.UseCors();

app.MapGet("/api/health", () => TypedResults.Ok(new ErrorResponse("ok")));

app.MapGet("/api/me", async (HttpContext ctx, BudgetStore store, CancellationToken ct) =>
{
    var caller = await CallerResolver.ResolveAsync(ctx, store, devEmail, ct);
    return TypedResults.Ok(new MeResponse(caller.IsAuthenticated, caller.Email, caller.Profile));
});

app.MapPost("/api/households", async (
    CreateHouseholdRequest request,
    HttpContext ctx,
    BudgetStore store,
    CancellationToken ct) =>
{
    var email = string.IsNullOrWhiteSpace(request.Email) ? devEmail : request.Email.Trim().ToLowerInvariant();

    if (await store.GetProfileAsync(email, ct) is not null)
        return Results.Conflict(new ErrorResponse("Den adressen tillhör redan ett hushåll."));

    var householdId = Guid.NewGuid().ToString();
    var memberId = Guid.NewGuid().ToString();
    var created = DateTime.UtcNow.ToString("yyyy-MM");

    var household = new Household(householdId, request.HouseholdName, created);
    var member = new Member(memberId, request.Name, email, "admin", "active", 0m);

    await store.PutMetaAsync(new BudgetMeta(household, null), ct);
    await store.PutMemberAsync(householdId, member, ct);
    await store.PutProfileAsync(new UserProfile(email, householdId, memberId), ct);

    var budget = await store.GetBudgetAsync(householdId, ct);
    return budget is null
        ? Results.Problem("Hushållet kunde inte läsas tillbaka.")
        : Results.Created($"/api/budget", budget);
});

/* ---------- Everything below needs a resolved household ---------- */

var api = app.MapGroup("/api");

api.MapGet("/budget", async (HttpContext ctx, BudgetStore store, CancellationToken ct) =>
{
    var caller = await CallerResolver.ResolveAsync(ctx, store, devEmail, ct);
    if (!caller.IsAuthenticated) return Results.Unauthorized();

    var budget = await store.GetBudgetAsync(caller.HouseholdId, ct);
    return budget is null ? Results.NotFound(new ErrorResponse("Inget hushåll")) : Results.Ok(budget);
});

api.MapPut("/household", async (
    RenameHouseholdRequest request,
    HttpContext ctx,
    BudgetStore store,
    CancellationToken ct) =>
{
    var caller = await CallerResolver.ResolveAsync(ctx, store, devEmail, ct);
    if (!caller.IsAuthenticated) return Results.Unauthorized();

    var meta = await store.GetMetaAsync(caller.HouseholdId, ct);
    if (meta is null) return Results.NotFound(new ErrorResponse("Inget hushåll"));

    await store.PutMetaAsync(meta with { Household = meta.Household with { Name = request.Name } }, ct);
    return Results.NoContent();
});

api.MapPut("/account-balance", async (
    AccountBalance balance,
    HttpContext ctx,
    BudgetStore store,
    CancellationToken ct) =>
{
    var caller = await CallerResolver.ResolveAsync(ctx, store, devEmail, ct);
    if (!caller.IsAuthenticated) return Results.Unauthorized();

    var meta = await store.GetMetaAsync(caller.HouseholdId, ct);
    if (meta is null) return Results.NotFound(new ErrorResponse("Inget hushåll"));

    await store.PutMetaAsync(meta with { AccountBalance = balance }, ct);
    return Results.NoContent();
});

api.MapPut("/members/{id}", async (
    string id, Member body, HttpContext ctx, BudgetStore store, CancellationToken ct) =>
    await Write(ctx, store, ct, (householdId, s) => s.PutMemberAsync(householdId, body with { Id = id }, ct)));

api.MapDelete("/members/{id}", async (
    string id, HttpContext ctx, BudgetStore store, CancellationToken ct) =>
    await Write(ctx, store, ct, (householdId, s) => s.DeleteMemberAsync(householdId, id, ct)));

api.MapPut("/costs/{id}", async (
    string id, RecurringCost body, HttpContext ctx, BudgetStore store, CancellationToken ct) =>
    await Write(ctx, store, ct, (householdId, s) => s.PutCostAsync(householdId, body with { Id = id }, ct)));

api.MapDelete("/costs/{id}", async (
    string id, HttpContext ctx, BudgetStore store, CancellationToken ct) =>
    await Write(ctx, store, ct, (householdId, s) => s.DeleteCostAsync(householdId, id, ct)));

api.MapPut("/oneoffs/{id}", async (
    string id, OneOffCost body, HttpContext ctx, BudgetStore store, CancellationToken ct) =>
    await Write(ctx, store, ct, (householdId, s) => s.PutOneOffAsync(householdId, body with { Id = id }, ct)));

api.MapDelete("/oneoffs/{id}", async (
    string id, HttpContext ctx, BudgetStore store, CancellationToken ct) =>
    await Write(ctx, store, ct, (householdId, s) => s.DeleteOneOffAsync(householdId, id, ct)));

api.MapPut("/loans/{id}", async (
    string id, Loan body, HttpContext ctx, BudgetStore store, CancellationToken ct) =>
    await Write(ctx, store, ct, (householdId, s) => s.PutLoanAsync(householdId, body with { Id = id }, ct)));

api.MapDelete("/loans/{id}", async (
    string id, HttpContext ctx, BudgetStore store, CancellationToken ct) =>
    await Write(ctx, store, ct, (householdId, s) => s.DeleteLoanAsync(householdId, id, ct)));

api.MapPut("/streams/{id}", async (
    string id, AmortizationStream body, HttpContext ctx, BudgetStore store, CancellationToken ct) =>
    await Write(ctx, store, ct, (householdId, s) => s.PutStreamAsync(householdId, body with { Id = id }, ct)));

api.MapDelete("/streams/{id}", async (
    string id, HttpContext ctx, BudgetStore store, CancellationToken ct) =>
    await Write(ctx, store, ct, (householdId, s) => s.DeleteStreamAsync(householdId, id, ct)));

api.MapPut("/income/{month}/{memberId}", async (
    string month, string memberId, PutIncomeRequest body,
    HttpContext ctx, BudgetStore store, CancellationToken ct) =>
    await Write(ctx, store, ct, (householdId, s) =>
        s.PutIncomeAsync(householdId, new IncomeEntry(memberId, month, body.Amount, body.EnteredById), ct)));

api.MapDelete("/income/{month}/{memberId}", async (
    string month, string memberId, HttpContext ctx, BudgetStore store, CancellationToken ct) =>
    await Write(ctx, store, ct, (householdId, s) => s.DeleteIncomeAsync(householdId, month, memberId, ct)));

api.MapPut("/dismissals/{month}/{memberId}", async (
    string month, string memberId, HttpContext ctx, BudgetStore store, CancellationToken ct) =>
    await Write(ctx, store, ct, (householdId, s) =>
        s.PutDismissalAsync(householdId, new DismissedPrompt(memberId, month), ct)));

api.MapDelete("/dismissals/{month}/{memberId}", async (
    string month, string memberId, HttpContext ctx, BudgetStore store, CancellationToken ct) =>
    await Write(ctx, store, ct, (householdId, s) => s.DeleteDismissalAsync(householdId, month, memberId, ct)));

app.Run();
return;

async Task<IResult> Write(
    HttpContext ctx,
    BudgetStore store,
    CancellationToken ct,
    Func<string, BudgetStore, Task> action)
{
    var caller = await CallerResolver.ResolveAsync(ctx, store, devEmail, ct);
    if (!caller.IsAuthenticated) return Results.Unauthorized();
    await action(caller.HouseholdId, store);
    return Results.NoContent();
}
