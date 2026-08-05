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

        var handler = async (ReminderEvent input, ILambdaContext context) =>
            await RunAsync(store, email, input, context, CancellationToken.None);

        await LambdaBootstrapBuilder
            .Create(handler, new SourceGeneratorLambdaJsonSerializer<ReminderJsonContext>())
            .Build()
            .RunAsync();
    }

    private static async Task RunAsync(
        BudgetStore store,
        EmailSender email,
        ReminderEvent input,
        ILambdaContext context,
        CancellationToken ct)
    {
        var localNow = TimeZoneInfo.ConvertTime(DateTimeOffset.UtcNow, Stockholm);
        var month = IncomeRules.CurrentMonth(localNow);

        var households = await store.ListHouseholdIdsAsync(ct);
        context.Logger.LogInformation($"Reminder run for {month}, final={input.Final}, households={households.Count}");

        var sent = 0;
        foreach (var householdId in households)
        {
            var budget = await store.GetBudgetAsync(householdId, ct);
            if (budget is null) continue;

            foreach (var member in IncomeRules.AwaitingIncome(budget, month))
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
        }

        context.Logger.LogInformation($"Sent {sent} reminder(s)");
    }
}
