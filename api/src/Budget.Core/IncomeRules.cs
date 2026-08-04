namespace Budget.Api;

/// <summary>
/// Shared with the web app's income module. An entry existing is what marks a
/// month as confirmed; no entry means the baseline is being assumed, which is not
/// the same thing and is exactly what the reminders chase.
/// </summary>
public static class IncomeRules
{
    public static bool HasConfirmedIncome(BudgetDto budget, string memberId, string month) =>
        budget.Income.Any(i => i.MemberId == memberId && i.Month == month);

    /// <summary>Active members still missing a figure for the month.</summary>
    public static List<Member> AwaitingIncome(BudgetDto budget, string month) =>
        budget.Members
            .Where(m => m.Status == "active" && !HasConfirmedIncome(budget, m.Id, month))
            .ToList();

    public static string CurrentMonth(DateTimeOffset now) => now.ToString("yyyy-MM");
}
