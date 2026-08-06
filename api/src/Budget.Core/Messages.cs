namespace Budget.Api;

/// <summary>
/// Wording for the mails, kept together so the tone stays consistent. Each member
/// carries their own language, so a household can be mixed: everyone is written to
/// in the language they chose in the app. Anything unrecognised falls back to
/// Swedish, which is what members created before the setting existed have.
/// </summary>
public static class Messages
{
    private static readonly string[] SwedishMonths =
    [
        "januari", "februari", "mars", "april", "maj", "juni",
        "juli", "augusti", "september", "oktober", "november", "december",
    ];

    private static readonly string[] EnglishMonths =
    [
        "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December",
    ];

    private static bool IsEnglish(string? language) =>
        string.Equals(language, "en", StringComparison.OrdinalIgnoreCase);

    public static string FormatMonth(string month, string? language = null)
    {
        var parts = month.Split('-');
        var names = IsEnglish(language) ? EnglishMonths : SwedishMonths;
        return $"{names[int.Parse(parts[1]) - 1]} {parts[0]}";
    }

    public static (string Subject, string Body) Invite(
        string householdName,
        string invitedBy,
        string appUrl,
        string? language = null) =>
        IsEnglish(language)
            ? ($"You have been invited to {householdName}",
                $"""
                {invitedBy} has added you to the household {householdName} in Budget.

                Sign in with Google using the same address this email was sent to and you go straight into the household.

                {appUrl}
                """)
            : ($"Du är inbjuden till {householdName}",
                $"""
                {invitedBy} har lagt till dig i hushållet {householdName} i Budget.

                Logga in med Google på samma adress som det här mejlet skickades till, så kommer du direkt in i hushållet.

                {appUrl}
                """);

    public static PushMessage PushTest(string? language) =>
        IsEnglish(language)
            ? new PushMessage("Budget", "Notifications are working.", "/")
            : new PushMessage("Budget", "Notiser fungerar.", "/");

    /// <summary>The same nudge as the mail, cut to what fits on a lock screen.</summary>
    public static PushMessage IncomePush(string month, bool isFinal, string? language)
    {
        var when = FormatMonth(month, language);
        return IsEnglish(language)
            ? new PushMessage(
                isFinal ? "Final reminder" : "Budget",
                $"Enter your income for {when}.",
                "/#income")
            : new PushMessage(
                isFinal ? "Sista påminnelsen" : "Budget",
                $"Fyll i din inkomst för {when}.",
                "/#income");
    }

    /// <summary>
    /// The month a loan's fixed term is renegotiated. Sent on the 1st, so there is
    /// a month to get an offer rather than being told once it has already reset.
    /// </summary>
    public static (string Subject, string Body) ResetNotice(
        string name,
        IReadOnlyList<string> loans,
        string month,
        string appUrl,
        string? language = null)
    {
        var when = FormatMonth(month, language);
        var list = string.Join("\n", loans.Select(loan => $"- {loan}"));

        if (IsEnglish(language))
        {
            return (loans.Count == 1
                ? $"{loans[0]} resets in {when}"
                : $"{loans.Count} loans reset in {when}",
                $"""
                Hi {name}!

                The fixed term ends this month for:

                {list}

                Worth asking for an offer before the rate rolls over on its own.

                {appUrl}
                """);
        }

        return (loans.Count == 1
            ? $"{loans[0]} har villkorsändringsdag i {when}"
            : $"{loans.Count} lån har villkorsändringsdag i {when}",
            $"""
            Hej {name}!

            Bindningstiden går ut den här månaden för:

            {list}

            Värt att be om ett omförhandlat erbjudande innan räntan läggs om av sig själv.

            {appUrl}
            """);
    }

    public static PushMessage ResetPush(IReadOnlyList<string> loans, string month, string? language)
    {
        var when = FormatMonth(month, language);
        var names = string.Join(", ", loans);

        return IsEnglish(language)
            ? new PushMessage(
                loans.Count == 1 ? "Fixed term ends" : "Fixed terms end",
                $"{names} resets in {when}.",
                "/#loans")
            : new PushMessage(
                "Villkorsändringsdag",
                $"{names} läggs om i {when}.",
                "/#loans");
    }

    public static (string Subject, string Body) IncomeReminder(
        string name,
        string month,
        string householdName,
        string appUrl,
        bool isFinal,
        string? language = null)
    {
        var when = FormatMonth(month, language);

        if (IsEnglish(language))
        {
            return (isFinal
                ? $"Final reminder: income for {when}"
                : $"Enter your income for {when}",
                $"""
                Hi {name}!

                You have not entered your income for {when} yet. Until you do, the budget for {householdName} assumes your normal income, which can make the split wrong.

                {appUrl}

                {(isFinal
                    ? "This is the last reminder this month."
                    : "You will get another reminder in a few days if it is still not filled in.")}
                """);
        }

        return (isFinal
            ? $"Sista påminnelsen: inkomst för {when}"
            : $"Fyll i din inkomst för {when}",
            $"""
            Hej {name}!

            Du har inte fyllt i din inkomst för {when} än. Tills du gör det räknar budgeten för {householdName} med din normala inkomst, vilket kan göra fördelningen fel.

            {appUrl}

            {(isFinal
                ? "Det här är den sista påminnelsen den här månaden."
                : "Du får en påminnelse till om några dagar om det inte är ifyllt.")}
            """);
    }
}
