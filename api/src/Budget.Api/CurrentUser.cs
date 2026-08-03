namespace Budget.Api;

/// <summary>
/// Who is calling, resolved from the session cookie. The Google ID token is only
/// seen once, at sign-in; every subsequent request carries this instead.
/// </summary>
public sealed record Caller(string? Email, UserProfile? Profile, Member? Member = null)
{
    public bool IsSignedIn => Email is not null;
    public bool HasHousehold => Profile is not null;
    public string HouseholdId => Profile!.HouseholdId;
    public string MemberId => Profile!.MemberId;
    public bool IsAdmin => Member?.Role == "admin";

    public static readonly Caller Anonymous = new(null, null);
}

public static class CallerResolver
{
    private const string ItemKey = "caller";

    public static async Task<Caller> ResolveAsync(
        HttpContext context,
        BudgetStore store,
        SessionTokens sessions,
        CancellationToken ct)
    {
        if (context.Items.TryGetValue(ItemKey, out var cached) && cached is Caller existing)
            return existing;

        context.Request.Cookies.TryGetValue(SessionTokens.CookieName, out var token);
        var email = await sessions.ReadAsync(token);

        Caller caller;
        if (email is null)
        {
            caller = Caller.Anonymous;
        }
        else
        {
            var profile = await store.GetProfileAsync(email, ct);
            var member = profile is null
                ? null
                : await store.GetMemberAsync(profile.HouseholdId, profile.MemberId, ct);

            // An invited member becomes active as soon as they turn up with a valid
            // session. Doing this at sign-in instead would strand anyone who was
            // invited while already holding a cookie, since they never sign in again.
            if (member is { Status: "invited" })
            {
                member = member with { Status = "active" };
                await store.PutMemberAsync(profile!.HouseholdId, member, ct);
            }

            caller = new Caller(email, profile, member);
        }

        context.Items[ItemKey] = caller;
        return caller;
    }

    public static void SetSessionCookie(HttpContext context, SessionTokens sessions, string email)
    {
        context.Response.Cookies.Append(
            SessionTokens.CookieName,
            sessions.Issue(email),
            new CookieOptions
            {
                HttpOnly = true,
                // The app and the API are same-origin behind CloudFront, so Lax is
                // enough and avoids the third-party cookie restrictions None attracts.
                SameSite = SameSiteMode.Lax,
                Secure = true,
                Path = "/",
                MaxAge = SessionTokens.Lifetime,
            });
    }

    public static void ClearSessionCookie(HttpContext context)
    {
        context.Response.Cookies.Delete(
            SessionTokens.CookieName,
            new CookieOptions { HttpOnly = true, SameSite = SameSiteMode.Lax, Secure = true, Path = "/" });
    }
}
