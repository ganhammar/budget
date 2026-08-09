# Mail and notifications

Sent through SES from `no-reply@pnkt.app`, on a domain verified with DKIM.
Permission is scoped to that one identity rather than `ses:SendEmail` on everything.

Each member is written to in the language they chose, so a household can be mixed.

## What goes out

**Invites** are sent when a member row is first written, and only then, so editing
someone later does not mail them again. The link carries no token: the household
member list grants access, and the recipient still signs in with Google as that
address.

**Income reminders** run on the 22nd, 25th and 27th at 08:00, and go to active
members with no confirmed figure for the month. Confirming stops your own reminders
without affecting anyone else's. The 27th is worded as the last one.

**Reset notices** run on the 1st and name the loans whose fixed term ends that
month, to the whole household: a rate rolling over changes what everyone pays, not
only whoever is down as payer.

All schedules are pinned to Europe/Stockholm. EventBridge Rules cannot express a
timezone and Scheduler can; without it the dates drift an hour twice a year.

## Channels

Email and push are separate opt-outs and mean the same thing whatever the news is.

Email is a preference on the member, because the address exists whether or not you
want to hear from it. Absent means on, so nobody who predates the setting is
silently opted out.

Push is the browser subscription itself, so unsubscribing is the opt-out and the
toggle reads the subscription rather than a stored flag. A switch that claims to be
on when nothing will arrive is worse than no switch.

Push encryption is RFC 8291 and RFC 8292, hand-rolled on
`System.Security.Cryptography`: the usual .NET libraries carry BouncyCastle and
reflection, which Native AOT breaks at runtime rather than at build time.
Subscriptions are checked against the known push-service hosts both where they are
stored and again before each send, and one the service reports as gone is deleted
during the run rather than retried every month.

Reminders ignore the in-app banner. Closing a banner is a convenience, not a
statement that the figure is handled.
