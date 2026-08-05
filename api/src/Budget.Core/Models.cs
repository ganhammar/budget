namespace Budget.Api;

/// <summary>
/// Categories belong to the household so each one can name its own. Null means the
/// household predates the setting; the client falls back to the categories its costs
/// already use, so nothing needs migrating.
/// </summary>
public sealed record Household(string Id, string Name, string Created, List<string>? Categories = null);

/// <summary>
/// Preferences are optional: records written before they existed simply have null,
/// which means the defaults. Language is stored rather than derived because the
/// reminder mails are composed server-side, with no browser to ask.
/// </summary>
public sealed record Member(
    string Id,
    string Name,
    string Email,
    string Role,
    string Status,
    decimal BaselineIncome,
    string? Language = null,
    string? Theme = null);

public sealed record IncomeEntry(string MemberId, string Month, decimal Amount, string? EnteredById);

/// <summary>
/// A stretch during which a cost is live. `From` is inclusive, `To` exclusive, and
/// either may be null for an open end.
/// </summary>
public sealed record ActivePeriod(string? From, string? To);

public sealed record RecurringCost(
    string Id,
    string Category,
    string Description,
    decimal Amount,
    int IntervalMonths,
    string FirstCharge,
    string? PayerId,
    /// <summary>
    /// Billing cadences like "every 8 weeks" do not land on a whole number of
    /// months. When set this wins over IntervalMonths and FirstChargeDate is the
    /// anchor instead of FirstCharge.
    /// </summary>
    int? IntervalWeeks = null,
    string? FirstChargeDate = null,
    /// <summary>
    /// On and off stretches. Null means always live, which is what every cost
    /// created before pausing existed looks like.
    /// </summary>
    List<ActivePeriod>? Periods = null);

public sealed record OneOffCost(
    string Id,
    string Description,
    decimal Total,
    string Start,
    string End,
    string? PayerId);

public sealed record Loan(
    string Id,
    string Description,
    decimal OriginalDebt,
    decimal NominalRate,
    string Fixation,
    string? ResetDate,
    string? PayerId);

public sealed record AmortizationStream(
    string Id,
    string Name,
    decimal Amount,
    string Start,
    string Mode,
    List<string> LoanIds);

public sealed record AccountBalance(string Month, decimal Amount);

/// <summary>Household-level state that has no natural collection of its own.</summary>
public sealed record BudgetMeta(Household Household, AccountBalance? AccountBalance);

/// <summary>The whole budget, assembled from one DynamoDB query.</summary>
public sealed record BudgetDto(
    Household Household,
    List<Member> Members,
    List<RecurringCost> RecurringCosts,
    List<OneOffCost> OneOffCosts,
    List<Loan> Loans,
    List<AmortizationStream> AmortizationStreams,
    List<IncomeEntry> Income,
    AccountBalance? AccountBalance);

/// <summary>Maps a sign-in identity to its household. Replaced by JWT claims later.</summary>
public sealed record UserProfile(string Email, string HouseholdId, string MemberId);

/* ---------- Requests ---------- */

/// <summary>The name comes from the request; the email always comes from the session.</summary>
public sealed record CreateHouseholdRequest(string HouseholdName, string Name);

public sealed record RenameHouseholdRequest(string Name);

public sealed record CategoriesRequest(List<string> Categories);

public sealed record PutIncomeRequest(decimal Amount, string? EnteredById);

/// <summary>The ID token issued by Google Identity Services in the browser.</summary>
public sealed record GoogleSignInRequest(string Credential);

public sealed record MeResponse(bool SignedIn, string? Email, UserProfile? Profile);

public sealed record ErrorResponse(string Message);
