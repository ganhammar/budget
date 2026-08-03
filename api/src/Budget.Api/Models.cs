namespace Budget.Api;

/// <summary>A month on the form "2026-08".</summary>
public sealed record Household(string Id, string Name, string Created);

public sealed record Member(
    string Id,
    string Name,
    string Email,
    string Role,
    string Status,
    decimal BaselineIncome);

public sealed record IncomeEntry(string MemberId, string Month, decimal Amount, string? EnteredById);

public sealed record DismissedPrompt(string MemberId, string Month);

public sealed record RecurringCost(
    string Id,
    string Category,
    string Description,
    decimal Amount,
    int IntervalMonths,
    string FirstCharge,
    string? PayerId);

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
    List<DismissedPrompt> DismissedPrompts,
    AccountBalance? AccountBalance);

/// <summary>Maps a sign-in identity to its household. Replaced by JWT claims later.</summary>
public sealed record UserProfile(string Email, string HouseholdId, string MemberId);

/* ---------- Requests ---------- */

/// <summary>The name comes from the request; the email always comes from the session.</summary>
public sealed record CreateHouseholdRequest(string HouseholdName, string Name);

public sealed record RenameHouseholdRequest(string Name);

public sealed record PutIncomeRequest(decimal Amount, string? EnteredById);

/// <summary>The ID token issued by Google Identity Services in the browser.</summary>
public sealed record GoogleSignInRequest(string Credential);

public sealed record MeResponse(bool SignedIn, string? Email, UserProfile? Profile);

public sealed record ErrorResponse(string Message);
