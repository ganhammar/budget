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
