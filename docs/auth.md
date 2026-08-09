# Authentication and roles

Google Identity Services hands the browser an ID token. It is posted once to
`/api/auth/session`, validated against Google's JWKS, and exchanged for an
HMAC-signed session cookie. Google is never consulted again.

The exchange exists because Google ID tokens last an hour and a browser cannot hold
a refresh token safely. The cookie carries 30 days instead. It is
`httpOnly; Secure; SameSite=Lax`, which is enough because the app and the API are
same-origin behind CloudFront.

**Authentication and authorization are separate.** A verified Google account with no
membership row gets a 401 and the create-household screen. That is why the consent
screen can be published without exposing anything: access is decided by the member
list, not by who Google will vouch for.

## Roles

Enforced on the server, not only in the UI.

| Action | Who |
|---|---|
| Rename the household, change the split, add or remove a member, resend an invite | Admin |
| Write income | The member it is about, or an admin on their behalf |
| Set the balance or the buffer goal | Any member |
| Edit your own record | You, but role, status, address and baseline come from the stored record |

That last row is why editing a member is not admin-only: saving your own
preferences goes through the same endpoint, and without it the smallest write in
the app would also be the one that grants an admin role.

A household cannot be left with no admin. Every route back to being one requires
one, so losing the last is the only mistake here with no repair from inside.

## Limits on abuse

Anyone with a Google account can create a household and invite addresses, and an
invite is mail this domain sends carrying text the sender chose. Names and
addresses are length-capped, a household holds at most five members and may send
ten invites a day counting resends, and the API stage is throttled.

## Deliberate limits

Three things a security review will raise, kept as they are on purpose:

The session is a bearer token with no revocation list, so signing out clears the
cookie without invalidating the token. Every request re-resolves the profile from
the address, so removing a member ends their access immediately, which is the case
that matters.

The API is reachable directly at its execute-api URL, bypassing the CloudFront
response headers. Those headers only mean anything to a browser, and a browser will
not attach the session cookie to that origin.

The development CORS entry for `localhost:5173` is registered in production. Under
`SameSite=Lax` it grants nothing, since the cookie is never sent cross-origin.
