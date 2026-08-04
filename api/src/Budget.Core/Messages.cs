namespace Budget.Api;

/// <summary>Wording for the mails, kept together so the tone stays consistent.</summary>
public static class Messages
{
    private static readonly string[] MonthNames =
    [
        "januari", "februari", "mars", "april", "maj", "juni",
        "juli", "augusti", "september", "oktober", "november", "december",
    ];

    public static string FormatMonth(string month)
    {
        var parts = month.Split('-');
        return $"{MonthNames[int.Parse(parts[1]) - 1]} {parts[0]}";
    }

    public static (string Subject, string Body) Invite(string householdName, string invitedBy, string appUrl) =>
        ($"Du är inbjuden till {householdName}",
            $"""
            {invitedBy} har lagt till dig i hushållet {householdName} i Budget.

            Logga in med Google på samma adress som det här mejlet skickades till, så kommer du direkt in i hushållet.

            {appUrl}
            """);

    public static (string Subject, string Body) IncomeReminder(
        string name,
        string month,
        string householdName,
        string appUrl,
        bool isFinal) =>
        (isFinal
            ? $"Sista påminnelsen: inkomst för {FormatMonth(month)}"
            : $"Fyll i din inkomst för {FormatMonth(month)}",
            $"""
            Hej {name}!

            Du har inte fyllt i din inkomst för {FormatMonth(month)} än. Tills du gör det räknar budgeten för {householdName} med din normala inkomst, vilket kan göra fördelningen fel.

            {appUrl}

            {(isFinal
                ? "Det här är den sista påminnelsen den här månaden."
                : "Du får en påminnelse till om några dagar om det inte är ifyllt.")}
            """);
}
