using System.Text.Json.Serialization;

namespace Budget.Api;

/// <summary>
/// Native AOT forbids reflection-based serialization, so every type crossing the
/// wire or going into DynamoDB has to be declared here.
/// </summary>
[JsonSourceGenerationOptions(PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase)]
[JsonSerializable(typeof(BudgetDto))]
[JsonSerializable(typeof(BudgetMeta))]
[JsonSerializable(typeof(Household))]
[JsonSerializable(typeof(Member))]
[JsonSerializable(typeof(RecurringCost))]
[JsonSerializable(typeof(ActivePeriod))]
[JsonSerializable(typeof(OneOffCost))]
[JsonSerializable(typeof(Loan))]
[JsonSerializable(typeof(LoanTerms))]
[JsonSerializable(typeof(AmortizationStream))]
[JsonSerializable(typeof(IncomeEntry))]
[JsonSerializable(typeof(AccountBalance))]
[JsonSerializable(typeof(UserProfile))]
[JsonSerializable(typeof(CreateHouseholdRequest))]
[JsonSerializable(typeof(GoogleSignInRequest))]
[JsonSerializable(typeof(RenameHouseholdRequest))]
[JsonSerializable(typeof(CategoriesRequest))]
[JsonSerializable(typeof(PutIncomeRequest))]
[JsonSerializable(typeof(MeResponse))]
[JsonSerializable(typeof(ErrorResponse))]
public sealed partial class AppJsonContext : JsonSerializerContext;
