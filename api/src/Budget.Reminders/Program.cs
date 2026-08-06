using System.Text.Json.Serialization;
using Amazon.DynamoDBv2;
using Amazon.Lambda.Core;
using Amazon.Lambda.RuntimeSupport;
using Amazon.Lambda.Serialization.SystemTextJson;
using Amazon.SimpleEmailV2;
using Budget.Api;

namespace Budget.Reminders;

/// <summary>
/// What the schedule sends us. The only thing that varies is whether this is the
/// last nudge of the month, which changes the wording.
/// </summary>
public sealed record ReminderEvent(bool Final = false);

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

        var households = await store.ListHouseholdIdsAsync(ct);
        context.Logger.LogInformation($"Reminder run for {month}, final={input.Final}, households={households.Count}");

        var sent = 0;
        var pushed = 0;
        foreach (var householdId in households)
        {
            // No caller, so no savings are read: the reminders never touch private data.
            var budget = await store.GetBudgetAsync(householdId, null, ct);
            if (budget is null) continue;

            foreach (var member in IncomeRules.AwaitingIncome(budget, month))
            {
                // Absent means on: members who predate the setting still get the mail.
                if (member.EmailReminders != false)
                {
                    var (subject, body) = Messages.IncomeReminder(
                        member.Name, month, budget.Household.Name, email.AppUrl, input.Final,
                        member.Language);

                    try
                    {
                        await email.SendAsync(member.Email, subject, body, ct);
                        sent++;
                    }
                    catch (Exception ex)
                    {
                        // One bad address must not stop the others being reminded.
                        context.Logger.LogError($"Could not email {member.Email}: {ex.Message}");
                    }
                }

                // Same nudge to whatever devices they have connected. A failure here
                // is not worth failing the run: the mail has already gone.
                if (push is null) continue;
                try
                {
                    var subscriptions =
                        await store.ListPushSubscriptionsAsync(householdId, member.Id, ct);
                    var message = Messages.IncomePush(month, input.Final, member.Language);
                    foreach (var subscription in subscriptions)
                    {
                        var result = await push.SendAsync(subscription, message, ct);
                        if (result == PushResult.Delivered) pushed++;
                        else if (result == PushResult.Expired)
                            await store.DeletePushSubscriptionAsync(
                                householdId, member.Id, subscription.Endpoint, ct);
                    }
                }
                catch (Exception ex)
                {
                    context.Logger.LogError($"Could not push to {member.Name}: {ex.Message}");
                }
            }
        }

        context.Logger.LogInformation($"Sent {sent} mail(s) and {pushed} push notification(s)");
    }
}
