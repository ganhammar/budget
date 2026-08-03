using System.Security.Cryptography;
using System.Text;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace Budget.Api;

/// <summary>
/// Our own session token. Google IDs expire after an hour and a browser cannot hold
/// a refresh token safely, so Google is exchanged once for this and the phone stays
/// signed in.
/// </summary>
public sealed class SessionTokens(byte[] signingKey)
{
    public const string CookieName = "budget_session";
    public static readonly TimeSpan Lifetime = TimeSpan.FromDays(30);

    private const string Issuer = "budget";

    private SymmetricSecurityKey Key => new(signingKey);

    public string Issue(string email)
    {
        var handler = new JsonWebTokenHandler();
        return handler.CreateToken(new SecurityTokenDescriptor
        {
            Issuer = Issuer,
            Audience = Issuer,
            Subject = new System.Security.Claims.ClaimsIdentity([new System.Security.Claims.Claim("sub", email)]),
            Expires = DateTime.UtcNow.Add(Lifetime),
            SigningCredentials = new SigningCredentials(Key, SecurityAlgorithms.HmacSha256),
        });
    }

    /// <summary>Returns the signed-in email, or null when the cookie is missing or invalid.</summary>
    public async Task<string?> ReadAsync(string? token)
    {
        if (string.IsNullOrWhiteSpace(token)) return null;

        var result = await new JsonWebTokenHandler().ValidateTokenAsync(
            token,
            new TokenValidationParameters
            {
                ValidIssuer = Issuer,
                ValidAudience = Issuer,
                IssuerSigningKey = Key,
                ValidateIssuer = true,
                ValidateAudience = true,
                ValidateLifetime = true,
                ValidateIssuerSigningKey = true,
                ClockSkew = TimeSpan.FromMinutes(2),
            });

        if (!result.IsValid) return null;
        return result.Claims.TryGetValue("sub", out var sub) && sub is string email ? email : null;
    }

    /// <summary>
    /// Development fallback so `dotnet run` works without a Google client. Never
    /// used when a real signing secret is configured.
    /// </summary>
    public static byte[] DevKey(string seed) =>
        SHA256.HashData(Encoding.UTF8.GetBytes($"budget-dev-key:{seed}"));
}
