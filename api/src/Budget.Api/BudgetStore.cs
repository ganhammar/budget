using System.Text.Json;
using Amazon.DynamoDBv2;
using Amazon.DynamoDBv2.Model;

namespace Budget.Api;

/// <summary>
/// Single-table access. Everything for one household shares a partition key, so the
/// whole budget loads in a single query. Entities are stored as JSON in a `data`
/// attribute: the only write pattern this app has is replacing a whole entity, so
/// there is nothing to gain from exploding them into typed attributes.
/// </summary>
public sealed class BudgetStore(IAmazonDynamoDB client, string tableName)
{
    private const string Meta = "META";
    private const string Profile = "PROFILE";

    private static string HouseholdKey(string householdId) => $"HH#{householdId}";
    private static string UserKey(string email) => $"USER#{email.ToLowerInvariant()}";

    private static AttributeValue S(string value) => new() { S = value };

    private static Dictionary<string, AttributeValue> Item(string pk, string sk, string json) =>
        new() { ["pk"] = S(pk), ["sk"] = S(sk), ["data"] = S(json) };

    private Task Put(string pk, string sk, string json, CancellationToken ct) =>
        client.PutItemAsync(new PutItemRequest { TableName = tableName, Item = Item(pk, sk, json) }, ct);

    private Task Delete(string pk, string sk, CancellationToken ct) =>
        client.DeleteItemAsync(
            new DeleteItemRequest
            {
                TableName = tableName,
                Key = new Dictionary<string, AttributeValue> { ["pk"] = S(pk), ["sk"] = S(sk) },
            },
            ct);

    /* ---------- Identity ---------- */

    public async Task<UserProfile?> GetProfileAsync(string email, CancellationToken ct)
    {
        var response = await client.GetItemAsync(
            new GetItemRequest
            {
                TableName = tableName,
                Key = new Dictionary<string, AttributeValue>
                {
                    ["pk"] = S(UserKey(email)),
                    ["sk"] = S(Profile),
                },
            },
            ct);

        if (!response.IsItemSet || !response.Item.TryGetValue("data", out var data)) return null;
        return JsonSerializer.Deserialize(data.S, AppJsonContext.Default.UserProfile);
    }

    public Task PutProfileAsync(UserProfile profile, CancellationToken ct) =>
        Put(
            UserKey(profile.Email),
            Profile,
            JsonSerializer.Serialize(profile, AppJsonContext.Default.UserProfile),
            ct);

    public Task DeleteProfileAsync(string email, CancellationToken ct) =>
        Delete(UserKey(email), Profile, ct);

    public async Task<Member?> GetMemberAsync(string householdId, string memberId, CancellationToken ct)
    {
        var response = await client.GetItemAsync(
            new GetItemRequest
            {
                TableName = tableName,
                Key = new Dictionary<string, AttributeValue>
                {
                    ["pk"] = S(HouseholdKey(householdId)),
                    ["sk"] = S($"MEMBER#{memberId}"),
                },
            },
            ct);

        if (!response.IsItemSet || !response.Item.TryGetValue("data", out var data)) return null;
        return JsonSerializer.Deserialize(data.S, AppJsonContext.Default.Member);
    }

    /* ---------- Whole budget ---------- */

    public async Task<BudgetDto?> GetBudgetAsync(string householdId, CancellationToken ct)
    {
        var members = new List<Member>();
        var costs = new List<RecurringCost>();
        var oneOffs = new List<OneOffCost>();
        var loans = new List<Loan>();
        var streams = new List<AmortizationStream>();
        var income = new List<IncomeEntry>();
        var dismissals = new List<DismissedPrompt>();
        BudgetMeta? meta = null;

        Dictionary<string, AttributeValue>? startKey = null;
        do
        {
            var page = await client.QueryAsync(
                new QueryRequest
                {
                    TableName = tableName,
                    KeyConditionExpression = "pk = :pk",
                    ExpressionAttributeValues = new Dictionary<string, AttributeValue>
                    {
                        [":pk"] = S(HouseholdKey(householdId)),
                    },
                    ExclusiveStartKey = startKey,
                },
                ct);

            foreach (var item in page.Items)
            {
                var sk = item["sk"].S;
                var json = item["data"].S;

                if (sk == Meta)
                    meta = JsonSerializer.Deserialize(json, AppJsonContext.Default.BudgetMeta);
                else if (sk.StartsWith("MEMBER#", StringComparison.Ordinal))
                    Add(members, JsonSerializer.Deserialize(json, AppJsonContext.Default.Member));
                else if (sk.StartsWith("COST#", StringComparison.Ordinal))
                    Add(costs, JsonSerializer.Deserialize(json, AppJsonContext.Default.RecurringCost));
                else if (sk.StartsWith("ONEOFF#", StringComparison.Ordinal))
                    Add(oneOffs, JsonSerializer.Deserialize(json, AppJsonContext.Default.OneOffCost));
                else if (sk.StartsWith("LOAN#", StringComparison.Ordinal))
                    Add(loans, JsonSerializer.Deserialize(json, AppJsonContext.Default.Loan));
                else if (sk.StartsWith("STREAM#", StringComparison.Ordinal))
                    Add(streams, JsonSerializer.Deserialize(json, AppJsonContext.Default.AmortizationStream));
                else if (sk.StartsWith("INCOME#", StringComparison.Ordinal))
                    Add(income, JsonSerializer.Deserialize(json, AppJsonContext.Default.IncomeEntry));
                else if (sk.StartsWith("DISMISS#", StringComparison.Ordinal))
                    Add(dismissals, JsonSerializer.Deserialize(json, AppJsonContext.Default.DismissedPrompt));
            }

            startKey = page.LastEvaluatedKey is { Count: > 0 } ? page.LastEvaluatedKey : null;
        } while (startKey is not null);

        if (meta is null) return null;

        return new BudgetDto(
            meta.Household,
            members,
            costs,
            oneOffs,
            loans,
            streams,
            income,
            dismissals,
            meta.AccountBalance);

        static void Add<T>(List<T> list, T? value)
        {
            if (value is not null) list.Add(value);
        }
    }

    /* ---------- Meta ---------- */

    public async Task<BudgetMeta?> GetMetaAsync(string householdId, CancellationToken ct)
    {
        var response = await client.GetItemAsync(
            new GetItemRequest
            {
                TableName = tableName,
                Key = new Dictionary<string, AttributeValue>
                {
                    ["pk"] = S(HouseholdKey(householdId)),
                    ["sk"] = S(Meta),
                },
            },
            ct);

        if (!response.IsItemSet || !response.Item.TryGetValue("data", out var data)) return null;
        return JsonSerializer.Deserialize(data.S, AppJsonContext.Default.BudgetMeta);
    }

    public Task PutMetaAsync(BudgetMeta meta, CancellationToken ct) =>
        Put(
            HouseholdKey(meta.Household.Id),
            Meta,
            JsonSerializer.Serialize(meta, AppJsonContext.Default.BudgetMeta),
            ct);

    /* ---------- Collections ---------- */

    public Task PutMemberAsync(string householdId, Member member, CancellationToken ct) =>
        Put(HouseholdKey(householdId), $"MEMBER#{member.Id}",
            JsonSerializer.Serialize(member, AppJsonContext.Default.Member), ct);

    public Task DeleteMemberAsync(string householdId, string id, CancellationToken ct) =>
        Delete(HouseholdKey(householdId), $"MEMBER#{id}", ct);

    public Task PutCostAsync(string householdId, RecurringCost cost, CancellationToken ct) =>
        Put(HouseholdKey(householdId), $"COST#{cost.Id}",
            JsonSerializer.Serialize(cost, AppJsonContext.Default.RecurringCost), ct);

    public Task DeleteCostAsync(string householdId, string id, CancellationToken ct) =>
        Delete(HouseholdKey(householdId), $"COST#{id}", ct);

    public Task PutOneOffAsync(string householdId, OneOffCost cost, CancellationToken ct) =>
        Put(HouseholdKey(householdId), $"ONEOFF#{cost.Id}",
            JsonSerializer.Serialize(cost, AppJsonContext.Default.OneOffCost), ct);

    public Task DeleteOneOffAsync(string householdId, string id, CancellationToken ct) =>
        Delete(HouseholdKey(householdId), $"ONEOFF#{id}", ct);

    public Task PutLoanAsync(string householdId, Loan loan, CancellationToken ct) =>
        Put(HouseholdKey(householdId), $"LOAN#{loan.Id}",
            JsonSerializer.Serialize(loan, AppJsonContext.Default.Loan), ct);

    public Task DeleteLoanAsync(string householdId, string id, CancellationToken ct) =>
        Delete(HouseholdKey(householdId), $"LOAN#{id}", ct);

    public Task PutStreamAsync(string householdId, AmortizationStream stream, CancellationToken ct) =>
        Put(HouseholdKey(householdId), $"STREAM#{stream.Id}",
            JsonSerializer.Serialize(stream, AppJsonContext.Default.AmortizationStream), ct);

    public Task DeleteStreamAsync(string householdId, string id, CancellationToken ct) =>
        Delete(HouseholdKey(householdId), $"STREAM#{id}", ct);

    public Task PutIncomeAsync(string householdId, IncomeEntry entry, CancellationToken ct) =>
        Put(HouseholdKey(householdId), $"INCOME#{entry.Month}#{entry.MemberId}",
            JsonSerializer.Serialize(entry, AppJsonContext.Default.IncomeEntry), ct);

    public Task DeleteIncomeAsync(string householdId, string month, string memberId, CancellationToken ct) =>
        Delete(HouseholdKey(householdId), $"INCOME#{month}#{memberId}", ct);

    public Task PutDismissalAsync(string householdId, DismissedPrompt prompt, CancellationToken ct) =>
        Put(HouseholdKey(householdId), $"DISMISS#{prompt.Month}#{prompt.MemberId}",
            JsonSerializer.Serialize(prompt, AppJsonContext.Default.DismissedPrompt), ct);

    public Task DeleteDismissalAsync(string householdId, string month, string memberId, CancellationToken ct) =>
        Delete(HouseholdKey(householdId), $"DISMISS#{month}#{memberId}", ct);
}
