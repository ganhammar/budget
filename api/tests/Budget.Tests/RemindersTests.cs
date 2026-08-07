using Budget.Api;
using Xunit;

namespace Budget.Tests;

/// <summary>
/// Who gets chased, and what they are told. Both runs of the reminder job read from
/// here, so a mistake reaches two people's inboxes on a schedule.
/// </summary>
public class IncomeRulesTests
{
    private static Member Member(string id, string status = "active") =>
        new(id, id, $"{id}@example.se", "member", status, 30000m);

    private static BudgetDto Budget(List<Member> members, List<IncomeEntry> income) =>
        new(new Household("h", "Dårskapet", "2024-01"), members, [], [], [], [], income, null, []);

    [Fact]
    public void Chases_an_active_member_with_no_figure()
    {
        var budget = Budget([Member("anton"), Member("petra")], []);
        Assert.Equal(["anton", "petra"], IncomeRules.AwaitingIncome(budget, "2026-08").Select(m => m.Id));
    }

    [Fact]
    public void Stops_once_the_figure_is_entered()
    {
        var budget = Budget(
            [Member("anton"), Member("petra")],
            [new IncomeEntry("anton", "2026-08", 48000m, null)]);

        Assert.Equal(["petra"], IncomeRules.AwaitingIncome(budget, "2026-08").Select(m => m.Id));
    }

    [Fact]
    public void A_figure_for_another_month_is_not_this_month()
    {
        var budget = Budget([Member("anton")], [new IncomeEntry("anton", "2026-07", 48000m, null)]);
        Assert.Single(IncomeRules.AwaitingIncome(budget, "2026-08"));
    }

    [Fact]
    public void Never_chases_someone_who_has_not_signed_in()
    {
        var budget = Budget([Member("anton", "invited")], []);
        Assert.Empty(IncomeRules.AwaitingIncome(budget, "2026-08"));
    }
}

public class MessageTests
{
    [Fact]
    public void Writes_to_each_member_in_the_language_they_chose()
    {
        var (swedish, _) = Messages.IncomeReminder("Anton", "2026-08", "Dårskapet", "https://pnkt.app", false, null);
        var (english, _) = Messages.IncomeReminder("Anton", "2026-08", "Dårskapet", "https://pnkt.app", false, "en");

        Assert.Contains("augusti 2026", swedish);
        Assert.Contains("August 2026", english);
    }

    [Fact]
    public void The_last_nudge_of_the_month_says_so()
    {
        var (ordinary, _) = Messages.IncomeReminder("Anton", "2026-08", "D", "https://pnkt.app", false, "en");
        var (final, body) = Messages.IncomeReminder("Anton", "2026-08", "D", "https://pnkt.app", true, "en");

        Assert.NotEqual(ordinary, final);
        Assert.Contains("last reminder", body);
    }

    [Fact]
    public void Anything_unrecognised_falls_back_to_swedish()
    {
        var (subject, _) = Messages.IncomeReminder("Anton", "2026-08", "D", "https://pnkt.app", false, "de");
        Assert.Contains("augusti", subject);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("en")]
    public void A_reset_notice_names_every_loan_resetting(string? language)
    {
        var (subject, body) = Messages.ResetNotice(
            "Anton", ["Huslån del 2", "Huslån del 3"], "2026-09", "https://pnkt.app", language);

        Assert.Contains("2", subject);
        Assert.Contains("Huslån del 2", body);
        Assert.Contains("Huslån del 3", body);
    }

    [Fact]
    public void One_loan_is_named_rather_than_counted()
    {
        var (subject, _) = Messages.ResetNotice(
            "Anton", ["Kia Sportage"], "2026-12", "https://pnkt.app", "en");
        Assert.StartsWith("Kia Sportage", subject);
    }

    [Fact]
    public void A_notification_carries_where_it_should_open()
    {
        Assert.Equal("/#income", Messages.IncomePush("2026-08", false, null).Url);
        Assert.Equal("/#loans", Messages.ResetPush(["Kia"], "2026-12", null).Url);
    }
}
