import { createHash, createHmac } from 'node:crypto';

/**
 * Mints the session cookie the API issues after a Google sign-in.
 *
 * Sign-in cannot be automated: it ends at Google. But the cookie is the whole of
 * the auth boundary, and locally the API signs it with a key derived from a fixed
 * seed, so a test can produce a real one and exercise the signed-in app rather
 * than only the page in front of it.
 *
 * This works against a local API and nothing else. Deployed, the key comes from
 * Secrets Manager and none of this is close.
 */
const base64url = (value: Buffer) => value.toString('base64url');

export function devSessionCookie(email: string, seed = 'local'): string {
  const key = createHash('sha256').update(`budget-dev-key:${seed}`).digest();

  const header = base64url(Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const claims = base64url(
    Buffer.from(
      JSON.stringify({
        iss: 'budget',
        aud: 'budget',
        sub: email,
        exp: Math.floor(Date.now() / 1000) + 3600,
      }),
    ),
  );

  const signature = base64url(createHmac('sha256', key).update(`${header}.${claims}`).digest());
  return `${header}.${claims}.${signature}`;
}
