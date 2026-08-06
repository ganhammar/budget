using System.Text.Json.Serialization;
using Amazon.DynamoDBv2;
using Amazon.Lambda.Core;
using Amazon.Lambda.RuntimeSupport;
using Amazon.Lambda.Serialization.SystemTextJson;
using Amazon.SimpleEmailV2;
using Budget.Api;

namespace Budget.Reminders;

/// <summary>
/// What the schedule sends us. <c>Kind</c> picks which run this is; <c>Final</c>
/// only means anything to the income run, where it changes the wording of the last
/// nudge of the month.
/// </summary>
public sealed record ReminderEvent(string? Kind = null, bool Final = false);

[JsonSerializable(typeof(ReminderEvent))]
internal sealed partial class ReminderJsonContext : JsonSerializerContext;

public static class Program
{
    /// <summary>
    /// The schedule fires on Swedish dates, so "this month" has to be resolved in
    /// Swedish time. On the 1st at 08:00 local, UTC is still the previous day but
    /// the same month, so this only matters around midnight; resolving it properly
    /// costs nothing and removes the edge case.
    /// </summary>
    private static readonly TimeZoneInfo Stockholm =
        TimeZoneInfo.FindSystemTimeZoneById("Europe/Stockholm");

    public static async Task Main()
    {
        var tableName = Environment.GetEnvironmentVariable("TABLE_NAME") ?? "budget";
        var fromAddress = Environment.GetEnvironmentVariable("FROM_ADDRESS") ?? "budget@ganhammar.se";
        var appUrl = Environment.GetEnvironmentVariable("APP_URL") ?? "https://budget.ganhammar.se";

        var store = new BudgetStore(new AmazonDynamoDBClient(), tableName);
        var email = new EmailSender(new AmazonSimpleEmailServiceV2Client(), fromAddress, appUrl);
        var push = await LoadPushSenderAsync(fromAddress);

        var handler = async (ReminderEvent input, ILambdaContext context) =>
            await RunAsync(store, email, push, input, context, CancellationToken.None);

        await LambdaBootstrapBuilder
            .Create(handler, new SourceGeneratorLambdaJsonSerializer<ReminderJsonContext>())
            .Build()
            .RunAsync();
    }

    /// <summary>Absent key means push is simply not sent; the mail still goes.</summary>
    private static async Task<PushSender?> LoadPushSenderAsync(string fromAddress)
    {
        var secretArn = Environment.GetEnvironmentVariable("VAPID_SECRET_ARN");
        var publicKey = Environment.GetEnvironmentVariable("VAPID_PUBLIC_KEY");
        if (string.IsNullOrWhiteSpace(secretArn) || string.IsNullOrWhiteSpace(publicKey)) return null;

        using var client = new Amazon.SecretsManager.AmazonSecretsManagerClient();
        var response = await client.GetSecretValueAsync(
            new Amazon.SecretsManager.Model.GetSecretValueRequest { SecretId = secretArn });
        var key = System.Security.Cryptography.ECDsa.Create();
        key.ImportPkcs8PrivateKey(Convert.FromBase64String(response.SecretString), out _);

        var subject = Environment.GetEnvironmentVariable("VAPID_SUBJECT") ?? $"mailto:{fromAddress}";
        return new PushSender(new HttpClient(), key, publicKey, subject);
    }

    private static async Task RunAsync(
        BudgetStore store,
        EmailSender email,
        PushSender? push,
        ReminderEvent input,
        ILambdaContext context,
        CancellationToken ct)
    {
        var localNow = TimeZoneInfo.ConvertTime(DateTimeOffset.UtcNow, Stockholm);
        var month = IncomeRules.CurrentMonth(localNow);
        var resets = string.Equals(input.Kind, "reset", StringComparison.OrdinalIgnoreCase);

        var households = await store.ListHouseholdIdsAsync(ct);
        context.Logger.LogInformation(
            $"Run for {month}, kind={input.Kind ?? "income"}, final={input.Final}, households={households.Count}");

        var sent = 0;
        var pushed = 0;
        foreach (var householdId in households)
        {
            // No caller, so no savings are read: the reminders never touch private data.
            var budget = await store.GetBudgetAsync(householdId, null, ct);
            if (budget is null) continue;

            var delivered = resets
                ? await ResetsAsync(store, email, push, householdId, budget, month, context, ct)
                : await IncomeAsync(
                    store, email, push, householdId, budget, month, input.Final, context, ct);

            sent += delivered.Sent;
            pushed += delivered.Pushed;
        }

        context.Logger.LogInformation($"Sent {sent} mail(s) and {pushed} push notification(s)");
    }

    private static async Task<Delivered> IncomeAsync(
        BudgetStore store,
        EmailSender email,
        PushSender? push,
        string householdId,
        BudgetDto budget,
        string month,
        bool final,
        ILambdaContext context,
        CancellationToken ct)
    {
        var delivered = new Delivered();
        foreach (var member in IncomeRules.AwaitingIncome(budget, month))
        {
            var mail = Messages.IncomeReminder(
                member.Name, month, budget.Household.Name, email.AppUrl, final, member.Language);

            delivered += await NotifyAsync(
                store, email, push, householdId, member, mail,
                Messages.IncomePush(month, final, member.Language), context, ct);
        }
        return delivered;
    }

    /// <summary>
    /// Loans whose fixed term ends this month, told to the whole household: a rate
    /// rolling over changes what everyone pays, not only whoever is down as payer.
    /// </summary>
    private static async Task<Delivered> ResetsAsync(
        BudgetStore store,
        EmailSender email,
        PushSender? push,
        string householdId,
        BudgetDto budget,
        string month,
        ILambdaContext context,
        CancellationToken ct)
    {
        var loans = budget.Loans
            .Where(loan => loan.ResetDate == month)
            .Select(loan => loan.Description)
            .ToList();
        if (loans.Count == 0) return new Delivered();

        var delivered = new Delivered();
        foreach (var member in budget.Members.Where(m => m.Status == "active"))
        {
            var mail = Messages.ResetNotice(
                member.Name, loans, month, email.AppUrl, member.Language);

            delivered += await NotifyAsync(
                store, email, push, householdId, member, mail,
                Messages.ResetPush(loans, month, member.Language), context, ct);
        }
        return delivered;
    }

    /// <summary>
    /// One notification down both channels, each honouring its own opt-out. Neither
    /// failing is worth failing the run: one bad address or one dead subscription
    /// must not stop everyone else being told.
    /// </summary>
    private static async Task<Delivered> NotifyAsync(
        BudgetStore store,
        EmailSender email,
        PushSender? push,
        string householdId,
        Member member,
        (string Subject, string Body) mail,
        PushMessage message,
        ILambdaContext context,
        CancellationToken ct)
    {
        var delivered = new Delivered();

        // Absent means on: members who predate the setting still get the mail.
        if (member.EmailReminders != false)
        {
            try
            {
                await email.SendAsync(member.Email, mail.Subject, mail.Body, ct);
                delivered = delivered with { Sent = 1 };
            }
            catch (Exception ex)
            {
                context.Logger.LogError($"Could not email {member.Email}: {ex.Message}");
            }
        }

        if (push is null) return delivered;
        try
        {
            var subscriptions = await store.ListPushSubscriptionsAsync(householdId, member.Id, ct);
            foreach (var subscription in subscriptions)
            {
                var result = await push.SendAsync(subscription, message, ct);
                if (result == PushResult.Delivered)
                    delivered = delivered with { Pushed = delivered.Pushed + 1 };
                else if (result == PushResult.Expired)
                    await store.DeletePushSubscriptionAsync(
                        householdId, member.Id, subscription.Endpoint, ct);
            }
        }
        catch (Exception ex)
        {
            context.Logger.LogError($"Could not push to {member.Name}: {ex.Message}");
        }

        return delivered;
    }

    private readonly record struct Delivered(int Sent = 0, int Pushed = 0)
    {
        public static Delivered operator +(Delivered a, Delivered b) =>
            new(a.Sent + b.Sent, a.Pushed + b.Pushed);
    }
}
