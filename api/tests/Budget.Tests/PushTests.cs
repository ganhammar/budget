using System.Security.Cryptography;
using System.Text;
using Budget.Api;
using Xunit;

namespace Budget.Tests;

public class PushEndpointTests
{
    [Theory]
    [InlineData("https://fcm.googleapis.com/fcm/send/abc")]
    [InlineData("https://updates.push.services.mozilla.com/wpush/v2/abc")]
    [InlineData("https://web.push.apple.com/abc")]
    [InlineData("https://sub.notify.windows.com/w/?token=abc")]
    public void Accepts_the_real_push_services(string endpoint) =>
        Assert.True(PushSender.IsKnownEndpoint(endpoint));

    [Theory]
    // The point of the check: an endpoint is a URL the server is told to POST to.
    [InlineData("http://fcm.googleapis.com/fcm/send/abc")]      // not https
    [InlineData("https://attacker.example/collect")]
    [InlineData("https://fcm.googleapis.com.attacker.example/")] // suffix, not the host
    [InlineData("https://169.254.169.254/latest/meta-data/")]
    [InlineData("file:///etc/passwd")]
    [InlineData("not a url")]
    [InlineData("")]
    public void Refuses_anything_else(string endpoint) =>
        Assert.False(PushSender.IsKnownEndpoint(endpoint));
}

/// <summary>
/// Both sides of these are our own code, so they prove the frame is well formed and
/// self-consistent rather than that a push service accepts it. A real device is the
/// only thing that proves the latter.
/// </summary>
public class WebPushTests
{
    private static (string P256dh, string Auth) Subscriber()
    {
        using var key = ECDiffieHellman.Create(ECCurve.NamedCurves.nistP256);
        var q = key.PublicKey.ExportParameters().Q;
        var point = new byte[65];
        point[0] = 0x04;
        q.X!.CopyTo(point, 1 + (32 - q.X!.Length));
        q.Y!.CopyTo(point, 33 + (32 - q.Y!.Length));
        return (Base64Url.Encode(point), Base64Url.Encode(RandomNumberGenerator.GetBytes(16)));
    }

    [Fact]
    public void Base64Url_round_trips_without_padding()
    {
        var bytes = RandomNumberGenerator.GetBytes(65);
        var encoded = Base64Url.Encode(bytes);

        Assert.DoesNotContain('=', encoded);
        Assert.DoesNotContain('+', encoded);
        Assert.DoesNotContain('/', encoded);
        Assert.Equal(bytes, Base64Url.Decode(encoded));
    }

    [Fact]
    public void Encrypt_frames_the_body_the_way_aes128gcm_is_read()
    {
        var (p256dh, auth) = Subscriber();
        var body = WebPush.Encrypt("""{"title":"pnkt"}""", p256dh, auth);

        // salt(16) | record size(4) | key id length(1) | key id(65) | ciphertext | tag(16)
        Assert.Equal(4096u, (uint)((body[16] << 24) | (body[17] << 16) | (body[18] << 8) | body[19]));
        Assert.Equal(65, body[20]);
        Assert.Equal(0x04, body[21]);
        Assert.True(body.Length > 16 + 4 + 1 + 65 + 16);
    }

    [Fact]
    public void Encrypt_never_repeats_a_salt()
    {
        var (p256dh, auth) = Subscriber();
        var first = WebPush.Encrypt("x", p256dh, auth)[..16];
        var second = WebPush.Encrypt("x", p256dh, auth)[..16];
        Assert.NotEqual(first, second);
    }

    [Fact]
    public void Authorization_is_a_vapid_jwt_for_the_service_origin_only()
    {
        using var key = ECDsa.Create(ECCurve.NamedCurves.nistP256);
        var header = WebPush.Authorization(
            new Uri("https://fcm.googleapis.com/fcm/send/abc"), "mailto:x@y.se", key);

        Assert.StartsWith("vapid t=", header);
        var jwt = header["vapid t=".Length..].Split(',')[0];
        var claims = Encoding.UTF8.GetString(Base64Url.Decode(jwt.Split('.')[1]));

        // The audience is the origin; carrying the subscription path would leak
        // which subscriber a request is for to anyone who sees the header.
        Assert.Contains("\"aud\":\"https://fcm.googleapis.com\"", claims);
        Assert.DoesNotContain("/fcm/send/abc", claims);
        Assert.Contains("\"sub\":\"mailto:x@y.se\"", claims);

        // ES256 is a raw r||s pair, not DER.
        Assert.Equal(64, Base64Url.Decode(jwt.Split('.')[2]).Length);
    }
}
