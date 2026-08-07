using System.Net;
using System.Net.Http.Headers;
using System.Security.Cryptography;

namespace Budget.Api;

/// <summary>What a notification says. Kept tiny: the payload is size-bounded.</summary>
public sealed record PushMessage(string Title, string Body, string Url);

/// <summary>
/// Delivers a notification to one browser. The push service only relays: the body
/// is encrypted for the subscriber, and VAPID proves the sender, so the service
/// itself can read neither the message nor who it is about.
/// </summary>
public sealed class PushSender(HttpClient http, ECDsa signingKey, string publicKey, string subject)
{
    /// <summary>
    /// The hosts a browser's own push service actually lives on. A subscription is
    /// a URL this server is told to POST to, and nothing about the shape of one
    /// proves where it came from, so an endpoint that is not a push service is
    /// something else wearing the name.
    /// </summary>
    private static readonly string[] PushHosts =
    [
        "fcm.googleapis.com",              // Chrome, Edge, and Chromium on Android
        "updates.push.services.mozilla.com", // Firefox
        "push.services.mozilla.com",
        "web.push.apple.com",             // Safari, iOS and macOS
        "notify.windows.com",             // Windows
        "wns2-by3p.notify.windows.com",
    ];

    /// <summary>
    /// Whether an endpoint is one we are willing to send to. Checked where a
    /// subscription is stored rather than only here, so a rejected one never
    /// reaches the table.
    /// </summary>
    public static bool IsKnownEndpoint(string endpoint) =>
        Uri.TryCreate(endpoint, UriKind.Absolute, out var uri)
        && uri.Scheme == Uri.UriSchemeHttps
        && PushHosts.Any(host =>
            uri.Host.Equals(host, StringComparison.OrdinalIgnoreCase)
            || uri.Host.EndsWith($".{host}", StringComparison.OrdinalIgnoreCase));

    public string PublicKey => publicKey;

    /// <summary>
    /// True when it was accepted. False means the subscription is gone and should
    /// be deleted: a browser that has been reinstalled or had permission revoked
    /// answers 404 or 410 forever, and retrying it is pure waste.
    /// </summary>
    public async Task<PushResult> SendAsync(
        PushSubscription subscription, PushMessage message, CancellationToken ct)
    {
        var payload =
            $$"""{"title":{{Json(message.Title)}},"body":{{Json(message.Body)}},"url":{{Json(message.Url)}}}""";

        // Belt and braces: a row written before this check existed is not a reason
        // to make the request now.
        if (!IsKnownEndpoint(subscription.Endpoint)) return PushResult.Expired;

        var endpoint = new Uri(subscription.Endpoint);
        var request = new HttpRequestMessage(HttpMethod.Post, endpoint)
        {
            Content = new ByteArrayContent(
                WebPush.Encrypt(payload, subscription.P256dh, subscription.Auth)),
        };
        request.Content.Headers.ContentType = new MediaTypeHeaderValue("application/octet-stream");
        request.Content.Headers.ContentEncoding.Add("aes128gcm");
        request.Headers.TryAddWithoutValidation(
            "Authorization", WebPush.Authorization(endpoint, subject, signingKey));
        // Ask the service to hold it for a day and to wake the device.
        request.Headers.TryAddWithoutValidation("TTL", "86400");
        request.Headers.TryAddWithoutValidation("Urgency", "normal");

        var response = await http.SendAsync(request, ct);
        if (response.IsSuccessStatusCode) return PushResult.Delivered;

        return response.StatusCode is HttpStatusCode.NotFound or HttpStatusCode.Gone
            ? PushResult.Expired
            : PushResult.Failed;
    }

    /// <summary>Minimal JSON string escaping; the payload has three known fields.</summary>
    private static string Json(string value)
    {
        var escaped = value
            .Replace("\\", "\\\\")
            .Replace("\"", "\\\"")
            .Replace("\n", "\\n")
            .Replace("\r", "\\r")
            .Replace("\t", "\\t");
        return $"\"{escaped}\"";
    }
}

public enum PushResult
{
    Delivered,
    /// <summary>The subscription no longer exists; stop keeping it.</summary>
    Expired,
    Failed,
}
