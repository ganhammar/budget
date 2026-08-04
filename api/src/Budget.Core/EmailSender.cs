using Amazon.SimpleEmailV2;
using Amazon.SimpleEmailV2.Model;

namespace Budget.Api;

/// <summary>
/// Transactional mail through SES. Shared by the API, which sends invites, and the
/// scheduled reminder job.
/// </summary>
public sealed class EmailSender(IAmazonSimpleEmailServiceV2 ses, string fromAddress, string appUrl)
{
    public string AppUrl => appUrl;

    public async Task SendAsync(string to, string subject, string bodyText, CancellationToken ct)
    {
        await ses.SendEmailAsync(
            new SendEmailRequest
            {
                FromEmailAddress = fromAddress,
                Destination = new Destination { ToAddresses = [to] },
                Content = new EmailContent
                {
                    Simple = new Message
                    {
                        Subject = new Content { Data = subject, Charset = "UTF-8" },
                        Body = new Body
                        {
                            Text = new Content { Data = bodyText, Charset = "UTF-8" },
                            Html = new Content { Data = Html(bodyText), Charset = "UTF-8" },
                        },
                    },
                },
            },
            ct);
    }

    /// <summary>
    /// Wraps the plain text rather than maintaining a second copy of every message.
    /// These are short notifications, not newsletters.
    /// </summary>
    private static string Html(string text)
    {
        var paragraphs = text
            .Split("\n\n", StringSplitOptions.RemoveEmptyEntries)
            .Select(p => $"<p>{Escape(p.Trim()).Replace("\n", "<br>")}</p>");

        return $"""
            <div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;font-size:15px;line-height:1.5;color:#0b0b0b">
            {string.Join("\n", paragraphs)}
            </div>
            """;
    }

    private static string Escape(string value) =>
        value.Replace("&", "&amp;").Replace("<", "&lt;").Replace(">", "&gt;");
}
