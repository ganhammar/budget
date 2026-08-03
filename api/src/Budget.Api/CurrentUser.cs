namespace Budget.Api;

/// <summary>
/// Who is calling. Today the email arrives in a header or falls back to a dev
/// value; when Google sign-in lands, only <see cref="Resolve"/> changes and every
/// endpoint keeps working against the same shape.
/// </summary>
public sealed record Caller(string Email, UserProfile? Profile)
{
    public bool IsAuthenticated => Profile is not null;
    public string HouseholdId => Profile!.HouseholdId;
    public string MemberId => Profile!.MemberId;
}

public static class CallerResolver
{
    public const string HeaderName = "X-Budget-User";
    private const string ItemKey = "caller";

    public static async Task<Caller> ResolveAsync(
        HttpContext context,
        BudgetStore store,
        string devEmail,
        CancellationToken ct)
    {
        if (context.Items.TryGetValue(ItemKey, out var cached) && cached is Caller existing)
            return existing;

        var header = context.Request.Headers[HeaderName].ToString();
        var email = string.IsNullOrWhiteSpace(header) ? devEmail : header.Trim().ToLowerInvariant();

        var caller = new Caller(email, await store.GetProfileAsync(email, ct));
        context.Items[ItemKey] = caller;
        return caller;
    }
}
