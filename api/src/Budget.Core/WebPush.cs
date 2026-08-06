using System.Security.Cryptography;
using System.Text;

namespace Budget.Api;

/// <summary>URL-safe base64 without padding, which is what every Web Push field uses.</summary>
public static class Base64Url
{
    public static string Encode(byte[] value) =>
        Convert.ToBase64String(value).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    public static byte[] Decode(string value)
    {
        var padded = value.Replace('-', '+').Replace('_', '/');
        return Convert.FromBase64String(padded.PadRight((padded.Length + 3) / 4 * 4, '='));
    }
}

/// <summary>
/// Message encryption (RFC 8291) and VAPID signing (RFC 8292) for Web Push.
///
/// Hand-rolled on System.Security.Cryptography rather than taken from a package:
/// the usual .NET web-push libraries carry BouncyCastle and reflection, which
/// Native AOT breaks at runtime rather than at build time. Everything used here
/// is in the box and AOT-clean.
/// </summary>
public static class WebPush
{
    /// <summary>Single record, so this only bounds the payload rather than splitting it.</summary>
    private const int RecordSize = 4096;

    private static readonly byte[] KeyInfo = Encoding.ASCII.GetBytes("Content-Encoding: aes128gcm\0");
    private static readonly byte[] NonceInfo = Encoding.ASCII.GetBytes("Content-Encoding: nonce\0");
    private static readonly byte[] AuthInfoPrefix = Encoding.ASCII.GetBytes("WebPush: info\0");

    /// <summary>
    /// The aes128gcm body to POST: header, then one encrypted record. `p256dh` and
    /// `auth` come from the browser's subscription.
    /// </summary>
    public static byte[] Encrypt(string payload, string p256dh, string auth)
    {
        var uaPublic = Base64Url.Decode(p256dh);
        var authSecret = Base64Url.Decode(auth);

        using var appServer = ECDiffieHellman.Create(ECCurve.NamedCurves.nistP256);
        var asPublic = ExportPoint(appServer.PublicKey.ExportParameters());

        using var uaKey = ECDiffieHellman.Create(ImportPoint(uaPublic));
        var shared = appServer.DeriveRawSecretAgreement(uaKey.PublicKey);

        // The auth secret salts the agreement, and the info string binds the result
        // to both parties' public keys so a key cannot be replayed against another.
        var authInfo = Concat(AuthInfoPrefix, uaPublic, asPublic);
        var ikm = HKDF.DeriveKey(HashAlgorithmName.SHA256, shared, 32, authSecret, authInfo);

        var salt = RandomNumberGenerator.GetBytes(16);
        var cek = HKDF.DeriveKey(HashAlgorithmName.SHA256, ikm, 16, salt, KeyInfo);
        var nonce = HKDF.DeriveKey(HashAlgorithmName.SHA256, ikm, 12, salt, NonceInfo);

        // 0x02 is the delimiter marking this as the final record.
        var plaintext = Concat(Encoding.UTF8.GetBytes(payload), [0x02]);
        var ciphertext = new byte[plaintext.Length];
        var tag = new byte[16];
        using (var aes = new AesGcm(cek, tag.Length))
        {
            aes.Encrypt(nonce, plaintext, ciphertext, tag);
        }

        // salt | record size | key id length | key id | ciphertext | tag
        var body = new byte[16 + 4 + 1 + asPublic.Length + ciphertext.Length + tag.Length];
        var at = 0;
        salt.CopyTo(body, at); at += salt.Length;
        BinaryPrimitivesWriteUInt32BigEndian(body, at, RecordSize); at += 4;
        body[at++] = (byte)asPublic.Length;
        asPublic.CopyTo(body, at); at += asPublic.Length;
        ciphertext.CopyTo(body, at); at += ciphertext.Length;
        tag.CopyTo(body, at);
        return body;
    }

    /// <summary>
    /// The Authorization header value proving the push is from this application
    /// server. Audience is the push service's origin, not the subscription path.
    /// </summary>
    public static string Authorization(Uri endpoint, string subject, ECDsa signingKey)
    {
        var audience = endpoint.GetLeftPart(UriPartial.Authority);
        var expires = DateTimeOffset.UtcNow.AddHours(12).ToUnixTimeSeconds();

        // Built by hand rather than serialized: two fixed shapes, and it keeps the
        // JSON context out of a security path.
        var header = Base64Url.Encode(Encoding.UTF8.GetBytes("""{"typ":"JWT","alg":"ES256"}"""));
        var claims = Base64Url.Encode(Encoding.UTF8.GetBytes(
            $$"""{"aud":"{{audience}}","exp":{{expires}},"sub":"{{subject}}"}"""));
        var signingInput = Encoding.ASCII.GetBytes($"{header}.{claims}");

        // ES256 wants the raw r||s pair, which is what SignData produces by default.
        var signature = signingKey.SignData(signingInput, HashAlgorithmName.SHA256);
        var jwt = $"{header}.{claims}.{Base64Url.Encode(signature)}";
        var publicKey = Base64Url.Encode(ExportPoint(signingKey.ExportParameters(false)));
        return $"vapid t={jwt}, k={publicKey}";
    }

    /// <summary>The 65-byte uncompressed point every Web Push field carries.</summary>
    private static byte[] ExportPoint(ECParameters parameters)
    {
        var x = parameters.Q.X!;
        var y = parameters.Q.Y!;
        var point = new byte[65];
        point[0] = 0x04;
        x.CopyTo(point, 1 + (32 - x.Length));
        y.CopyTo(point, 33 + (32 - y.Length));
        return point;
    }

    private static ECParameters ImportPoint(byte[] point) =>
        new()
        {
            Curve = ECCurve.NamedCurves.nistP256,
            Q = new ECPoint { X = point[1..33], Y = point[33..65] },
        };

    private static void BinaryPrimitivesWriteUInt32BigEndian(byte[] target, int offset, uint value)
    {
        target[offset] = (byte)(value >> 24);
        target[offset + 1] = (byte)(value >> 16);
        target[offset + 2] = (byte)(value >> 8);
        target[offset + 3] = (byte)value;
    }

    private static byte[] Concat(params byte[][] parts)
    {
        var result = new byte[parts.Sum(p => p.Length)];
        var at = 0;
        foreach (var part in parts)
        {
            part.CopyTo(result, at);
            at += part.Length;
        }
        return result;
    }
}
