using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace Budget.Api;

public sealed record GoogleIdentity(string Email, string Name);

/// <summary>
/// Validates the ID token that Google Identity Services hands to the browser.
/// Google is only consulted at sign-in; from then on the caller carries our own
/// session cookie, so this never runs on a normal request.
/// </summary>
public sealed class GoogleTokenValidator(HttpClient http, string clientId)
{
    private const string JwksUri = "https://www.googleapis.com/oauth2/v3/certs";

    private static readonly string[] ValidIssuers =
        ["https://accounts.google.com", "accounts.google.com"];

    private JsonWebKeySet? _keys;
    private DateTimeOffset _keysFetchedAt = DateTimeOffset.MinValue;
    private readonly SemaphoreSlim _lock = new(1, 1);

    private async Task<JsonWebKeySet> GetKeysAsync(CancellationToken ct)
    {
        // Google rotates these; an hour is well inside their published cadence.
        if (_keys is not null && DateTimeOffset.UtcNow - _keysFetchedAt < TimeSpan.FromHours(1))
            return _keys;

        await _lock.WaitAsync(ct);
        try
        {
            if (_keys is not null && DateTimeOffset.UtcNow - _keysFetchedAt < TimeSpan.FromHours(1))
                return _keys;

            var json = await http.GetStringAsync(JwksUri, ct);
            _keys = new JsonWebKeySet(json);
            _keysFetchedAt = DateTimeOffset.UtcNow;
            return _keys;
        }
        finally
        {
            _lock.Release();
        }
    }

    /// <summary>Returns null when the token is not a valid, verified Google identity.</summary>
    public async Task<GoogleIdentity?> ValidateAsync(string idToken, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(idToken)) return null;

        var keys = await GetKeysAsync(ct);
        var handler = new JsonWebTokenHandler();

        var result = await handler.ValidateTokenAsync(
            idToken,
            new TokenValidationParameters
            {
                ValidIssuers = ValidIssuers,
                ValidAudience = clientId,
                IssuerSigningKeys = keys.GetSigningKeys(),
                ValidateIssuer = true,
                ValidateAudience = true,
                ValidateLifetime = true,
                ValidateIssuerSigningKey = true,
                ClockSkew = TimeSpan.FromMinutes(2),
            });

        if (!result.IsValid) return null;

        var claims = result.Claims;
        if (!claims.TryGetValue("email", out var email) || email is not string address) return null;

        // An unverified address could be anyone; Google only vouches for verified ones.
        if (claims.TryGetValue("email_verified", out var verified))
        {
            var ok = verified switch
            {
                bool b => b,
                string s => bool.TryParse(s, out var parsed) && parsed,
                _ => false,
            };
            if (!ok) return null;
        }

        var name = claims.TryGetValue("name", out var n) && n is string s2 && !string.IsNullOrWhiteSpace(s2)
            ? s2
            : address.Split('@')[0];

        return new GoogleIdentity(address.ToLowerInvariant(), name);
    }
}
