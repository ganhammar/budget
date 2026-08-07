using System.Text;
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

    /// <summary>
    /// Counts one invite against the household's allowance for the day and returns
    /// the new total. Atomic, so two requests at once cannot both see the same
    /// number and both decide there is room.
    ///
    /// The row carries an expiry attribute for the day after it stops mattering.
    /// TTL is not enabled on the table, so nothing collects them today; they are one
    /// small row per household per day on which an invite was actually sent.
    /// </summary>
    public async Task<long> CountInviteAsync(string householdId, DateOnly day, CancellationToken ct)
    {
        var expires = new DateTimeOffset(day.AddDays(2), TimeOnly.MinValue, TimeSpan.Zero)
            .ToUnixTimeSeconds();

        var response = await client.UpdateItemAsync(
            new UpdateItemRequest
            {
                TableName = tableName,
                Key = new Dictionary<string, AttributeValue>
                {
                    ["pk"] = S(HouseholdKey(householdId)),
                    ["sk"] = S($"INVITES#{day:yyyy-MM-dd}"),
                },
                UpdateExpression = "ADD sent :one SET expires = :expires",
                ExpressionAttributeValues = new Dictionary<string, AttributeValue>
                {
                    [":one"] = new() { N = "1" },
                    [":expires"] = new() { N = expires.ToString() },
                },
                ReturnValues = ReturnValue.UPDATED_NEW,
            },
            ct);

        return response.Attributes.TryGetValue("sent", out var sent) ? long.Parse(sent.N) : 0;
    }

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

    /* ---------- All households ---------- */

    /// <summary>
    /// Every household id. A scan rather than an index: there is no access pattern
    /// that lists households except the monthly reminder job, and at household
    /// scale a filtered scan costs less than carrying a GSI.
    /// </summary>
    public async Task<List<string>> ListHouseholdIdsAsync(CancellationToken ct)
    {
        var ids = new List<string>();
        Dictionary<string, AttributeValue>? startKey = null;

        do
        {
            var page = await client.ScanAsync(
                new ScanRequest
                {
                    TableName = tableName,
                    FilterExpression = "sk = :meta",
                    ProjectionExpression = "pk",
                    ExpressionAttributeValues = new Dictionary<string, AttributeValue>
                    {
                        [":meta"] = S(Meta),
                    },
                    ExclusiveStartKey = startKey,
                },
                ct);

            foreach (var item in page.Items)
            {
                var pk = item["pk"].S;
                if (pk.StartsWith("HH#", StringComparison.Ordinal)) ids.Add(pk[3..]);
            }

            startKey = page.LastEvaluatedKey is { Count: > 0 } ? page.LastEvaluatedKey : null;
        } while (startKey is not null);

        return ids;
    }

    /* ---------- Whole budget ---------- */

    /// <summary>
    /// The household's budget as <paramref name="callerMemberId"/> may see it. Savings
    /// belong to one member and are dropped for everyone else here, in the only place
    /// that reads them, so no caller can receive another member's.
    /// </summary>
    public async Task<BudgetDto?> GetBudgetAsync(
        string householdId, string? callerMemberId, CancellationToken ct)
    {
        var members = new List<Member>();
        var costs = new List<RecurringCost>();
        var oneOffs = new List<OneOffCost>();
        var loans = new List<Loan>();
        var streams = new List<AmortizationStream>();
        var income = new List<IncomeEntry>();
        var savings = new List<Saving>();
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
                else if (callerMemberId is not null
                    && sk.StartsWith($"SAVING#{callerMemberId}#", StringComparison.Ordinal))
                    Add(savings, JsonSerializer.Deserialize(json, AppJsonContext.Default.Saving));
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
            meta.AccountBalance,
            savings);

        static void Add<T>(List<T> list, T? value)
        {
            if (value is not null) list.Add(value);
        }
    }

    /* ---------- Push subscriptions ---------- */

    /// <summary>
    /// The endpoint is too long and too punctuated for a sort key, so it is hashed.
    /// Same device subscribing twice therefore replaces rather than duplicates.
    /// </summary>
    private static string EndpointKey(string endpoint)
    {
        var hash = System.Security.Cryptography.SHA256.HashData(Encoding.UTF8.GetBytes(endpoint));
        return Convert.ToHexString(hash)[..16];
    }

    public Task PutPushSubscriptionAsync(
        string householdId, PushSubscription subscription, CancellationToken ct) =>
        Put(HouseholdKey(householdId),
            $"PUSH#{subscription.MemberId}#{EndpointKey(subscription.Endpoint)}",
            JsonSerializer.Serialize(subscription, AppJsonContext.Default.PushSubscription), ct);

    public Task DeletePushSubscriptionAsync(
        string householdId, string memberId, string endpoint, CancellationToken ct) =>
        Delete(HouseholdKey(householdId), $"PUSH#{memberId}#{EndpointKey(endpoint)}", ct);

    public async Task<List<PushSubscription>> ListPushSubscriptionsAsync(
        string householdId, string memberId, CancellationToken ct)
    {
        var response = await client.QueryAsync(
            new QueryRequest
            {
                TableName = tableName,
                KeyConditionExpression = "pk = :pk AND begins_with(sk, :sk)",
                ExpressionAttributeValues = new Dictionary<string, AttributeValue>
                {
                    [":pk"] = S(HouseholdKey(householdId)),
                    [":sk"] = S($"PUSH#{memberId}#"),
                },
            },
            ct);

        var found = new List<PushSubscription>();
        foreach (var item in response.Items)
        {
            var value = JsonSerializer.Deserialize(
                item["data"].S, AppJsonContext.Default.PushSubscription);
            if (value is not null) found.Add(value);
        }
        return found;
    }

    /* ---------- Savings ---------- */

    public Task PutSavingAsync(string householdId, Saving saving, CancellationToken ct) =>
        Put(HouseholdKey(householdId), $"SAVING#{saving.MemberId}#{saving.Id}",
            JsonSerializer.Serialize(saving, AppJsonContext.Default.Saving), ct);

    public Task DeleteSavingAsync(string householdId, string memberId, string id, CancellationToken ct) =>
        Delete(HouseholdKey(householdId), $"SAVING#{memberId}#{id}", ct);

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

    /// <summary>
    /// Writes the three rows a household is made of at once.
    ///
    /// Separately, a failure between them leaves something unusable: meta with no
    /// member, or a member nobody's address maps to. Nothing in the app can repair
    /// that, and the person it happens to cannot create another household because
    /// the profile pointing at the broken one already exists.
    /// </summary>
    public Task CreateHouseholdAsync(
        BudgetMeta meta, Member member, UserProfile profile, CancellationToken ct)
    {
        var householdId = meta.Household.Id;

        return client.TransactWriteItemsAsync(
            new TransactWriteItemsRequest
            {
                TransactItems =
                [
                    new TransactWriteItem
                    {
                        Put = new Put
                        {
                            TableName = tableName,
                            Item = Item(
                                HouseholdKey(householdId),
                                Meta,
                                JsonSerializer.Serialize(meta, AppJsonContext.Default.BudgetMeta)),
                        },
                    },
                    new TransactWriteItem
                    {
                        Put = new Put
                        {
                            TableName = tableName,
                            Item = Item(
                                HouseholdKey(householdId),
                                $"MEMBER#{member.Id}",
                                JsonSerializer.Serialize(member, AppJsonContext.Default.Member)),
                        },
                    },
                    new TransactWriteItem
                    {
                        Put = new Put
                        {
                            TableName = tableName,
                            Item = Item(
                                UserKey(profile.Email),
                                Profile,
                                JsonSerializer.Serialize(profile, AppJsonContext.Default.UserProfile)),
                            // Two tabs pressing create at once should make one
                            // household, not overwrite the first with the second.
                            ConditionExpression = "attribute_not_exists(pk)",
                        },
                    },
                ],
            },
            ct);
    }

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

}
