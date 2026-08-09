# The model

What the app is for: knowing what each person transfers to the joint account each
month, and what is left for them afterwards.

## Costs

**Recurring costs** carry `amount`, `intervalMonths` and a `firstCharge` anchor, so
"6 000 kr every 6 months from December" keeps its shape. Two figures fall out of
that and are used for different things:

- **Budgeted monthly** (`amount / intervalMonths`) drives the split. It has to stay
  stable: nobody's contribution should jump because the car insurance lands in June.
- **Actual cash flow** is the real charge in the months it hits, and drives the
  joint account forecast.

Cadences shorter than a month use `intervalWeeks`, which can land twice in one
month. Every four weeks does so about once a year, and the forecast would be short
a whole charge if that month counted once.

**One-off costs** are short-term loans from the household to itself. The full
amount leaves the account at `start`, and the monthly share is collected until
`end`, so the account dips and recovers to net zero. A one-off can instead be
[taken from the buffer](buffer.md#absorbing-a-one-off), in which case nobody repays
it.

**Categories** are per household and free-form. There are no defaults: a household
that has never made one has none.

## Loans

Monthly interest is `debt × nominalRate / 12`. The effective rate
(`(1 + r/12)^12 − 1`) is shown for comparison only and never used for the charge,
because dividing an effective rate by twelve double-counts compounding.

Debt is derived rather than stored: original debt minus amortization applied since
the stream started. A loan does not exist before the month it was taken out.

**Amortization streams** are separate from loans. `parallel` splits the amount
evenly across its loans; `priority` clears them in order, rolling the whole amount
onto the next once one is settled.

## Values that change over time

Rates, charges, payers and amortization amounts are all `{ from: Month, ... }`
entries on the entity. The value in force for a month is the latest entry at or
before it, falling back to the entity's own field for anything recorded before
dated terms existed.

This is why editing a loan and changing its rate are separate actions. Editing
corrects what was always true; changing a rate records that something became true
in a given month, and leaves every month before it alone.

## Income

Each member has one standing baseline, entered after tax. Actual figures are
confirmed per month; the presence of an entry is what marks a month as confirmed.
A month with no entry falls back to the baseline and is shown as an estimate.

A member may write their own figure, an admin may write anyone's.

## The split

The household chooses how costs are divided. All three reduce to one number per
member, the share of the month's costs they carry, from which both figures anyone
reads follow: transfer that less what you already paid directly, keep what your
income exceeds it by.

| Rule | Share of costs |
|---|---|
| `equalLeftover` | `income − surplus / members`, so everyone keeps the same |
| `byIncome` | `costs × income / totalIncome`, so leftovers stay in proportion |
| `even` | `costs / members`, whatever the incomes |

Absent means `equalLeftover`, which is what every household had before the setting
existed. Anything with a `payerId` is paid directly by that member and deducted
from their transfer; it does not change the split itself.

## Savings

Personal long-term saving, private to the member who owns it. Filtered out
server-side for every other caller, so another member's savings never reach the
browser. They reduce what the owner has left and are invisible to everyone else.
