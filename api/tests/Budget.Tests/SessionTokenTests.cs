using System.Text;
using Budget.Api;
using Xunit;

namespace Budget.Tests;

/// <summary>
/// The cookie is the whole of the auth boundary: whatever it says the caller is,
/// the caller is. These cover the ways it must refuse to say anything.
/// </summary>
public class SessionTokenTests
{
    private static SessionTokens Tokens(string secret = "a-key-long-enough-for-hmac-sha256-x") =>
        new(Encoding.UTF8.GetBytes(secret));

    [Fact]
    public async Task Round_trips_the_signed_in_address()
    {
        var tokens = Tokens();
        Assert.Equal("anton@example.se", await tokens.ReadAsync(tokens.Issue("anton@example.se")));
    }

    [Fact]
    public async Task Rejects_a_token_signed_with_another_key()
    {
        var issued = Tokens("one-key-long-enough-for-hmac-sha256-a").Issue("anton@example.se");
        Assert.Null(await Tokens("another-key-long-enough-for-hmac-256").ReadAsync(issued));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("not-a-token")]
    [InlineData("a.b.c")]
    public async Task Rejects_anything_that_is_not_a_token(string? token)
    {
        Assert.Null(await Tokens().ReadAsync(token));
    }

    [Fact]
    public async Task Rejects_a_tampered_payload()
    {
        var tokens = Tokens();
        var issued = tokens.Issue("anton@example.se");

        // Same signature, different claims: the part an attacker controls.
        var parts = issued.Split('.');
        var payload = Encoding.UTF8.GetString(Base64Url.Decode(parts[1]))
            .Replace("anton@example.se", "petra@example.se");
        var forged = $"{parts[0]}.{Base64Url.Encode(Encoding.UTF8.GetBytes(payload))}.{parts[2]}";

        Assert.Null(await tokens.ReadAsync(forged));
    }

    [Fact]
    public void Development_key_is_stable_and_specific_to_its_seed()
    {
        Assert.Equal(SessionTokens.DevKey("local"), SessionTokens.DevKey("local"));
        Assert.NotEqual(SessionTokens.DevKey("local"), SessionTokens.DevKey("other"));
    }
}
