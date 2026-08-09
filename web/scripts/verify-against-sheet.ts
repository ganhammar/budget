/**
 * Checks that the engine reproduces the numbers from the original spreadsheet.
 * Run with: npx tsx scripts/verify-against-sheet.ts
 *
 * Where the engine and the sheet disagree, the sheet is the one that is wrong:
 * it applies ROUNDUP to each loan's interest, inflating the total by 3.72 kr/month.
 */
import type { Budget, RecurringCost, SplitRule } from '../src/domain/types';
import {
  averageCommitment,
  bufferGoal,
  bufferTopUp,
  calculateMonth,
  debtAtStartOf,
  effectiveRate,
  forecast,
  incomeAboveNormal,
  savingsTotal,
} from '../src/domain/engine';
import {
  canEditIncomeFor,
  incomeHistory,
  membersAwaitingIncome,
  shouldPromptForIncome,
} from '../src/domain/income';
import { addMonths } from '../src/domain/month';

const ANTON = 'anton';
const PETRA = 'petra';
const MONTH = '2026-08';

function buildBudget(rate: number): Budget {
  const cost = (
    description: string,
    amount: number,
    intervalMonths: number,
    payerId?: string,
  ): RecurringCost => ({
    id: description,
    category: 'Övrigt',
    description,
    amount,
    intervalMonths,
    firstCharge: '2026-01',
    payerId,
  });

  const loan = (id: string, originalDebt: number) => ({
    id,
    description: id,
    originalDebt,
    nominalRate: rate,
    fixation: 'floating3m' as const,
  });

  return {
    household: { id: 'h', name: 'Test', created: '2026-01' },
    members: [
      { id: ANTON, name: 'Anton', email: 'a@x.se', role: 'admin', status: 'active', baselineIncome: 48000 },
      { id: PETRA, name: 'Petra', email: 'p@x.se', role: 'member', status: 'active', baselineIncome: 37887 },
    ],
    recurringCosts: [
      // The items the sheet tags with a payer, reproduced exactly.
      cost('Bo Kvar Försäkring', 284, 1, ANTON),
      cost('Google One', 290, 12, ANTON),
      cost('Spotify', 219, 1, ANTON),
      cost('HBO', 64.5, 1, ANTON),
      cost('Netflix', 219, 1, ANTON),
      cost('Flora Mobil', 115, 1, ANTON),
      cost('Apple TV', 119, 1, ANTON),
      cost('Storytel', 228, 1, PETRA),
      cost('Cmore', 149, 1, PETRA),
      // The rest lumped together, only the total matters for this check.
      cost('Other shared costs', 20078.5555, 1),
    ],
    oneOffCosts: [],
    loans: [
      loan('Original 1', 1074637),
      loan('Original 2', 1074632),
      loan('Original 3', 1074632),
      loan('Renovation', 810000),
      loan('Framsida', 60000),
      loan('Kia Sportage', 380000),
    ],
    amortizationStreams: [
      {
        id: 's1',
        name: 'House loan',
        amount: 8000,
        start: '2022-09',
        mode: 'parallel',
        loanIds: ['Original 1', 'Original 2', 'Original 3'],
      },
      {
        id: 's2',
        name: 'Framsida then car',
        amount: 5000,
        start: '2026-02',
        mode: 'priority',
        loanIds: ['Framsida', 'Kia Sportage'],
      },
    ],
    income: [],
    accountBalance: { month: MONTH, amount: 25000 },
    savings: [],
  };
}

let failures = 0;

function check(label: string, actual: number, expected: number, tolerance = 1, note?: string) {
  const ok = Math.abs(actual - expected) <= tolerance;
  if (!ok) failures++;
  console.log(
    `${ok ? '  ok  ' : ' FAIL '} ${label.padEnd(28)} ${actual.toFixed(2).padStart(11)}` +
      `  expected ${expected}${note ? `  · ${note}` : ''}`,
  );
}

const ROUNDING = 'sheet ROUNDUPs each loan, adding 3.72 kr/month';

console.log("\n— Using the sheet's 2.65% —");
const sheetBudget = buildBudget(0.0265);
const sheetResult = calculateMonth(sheetBudget, MONTH);

check('Debt, original loan 1', sheetResult.loanLines[0].debt, 949303.67, 0.5);
check('Debt, Framsida', sheetResult.loanLines[4].debt, 30000, 0.5);
check('Total debt', sheetResult.loanLines.reduce((s, l) => s + l.debt, 0), 4067901, 20);
check('Interest', sheetResult.loanLines.reduce((s, l) => s + l.interest, 0), 8983.28, 0.5, ROUNDING);
check('Loans this month', sheetResult.loanTotal, 21983.28, 0.5, ROUNDING);
check('Shared costs', sheetResult.recurringTotal, 21500.22);
check('Total costs', sheetResult.totalCosts, 43483.5, 0.5, ROUNDING);
check('Total income', sheetResult.totalIncome, 85887);
check('Surplus', sheetResult.surplus, 42403.5, 0.5, ROUNDING);
check('Surplus per member', sheetResult.surplusPerMember, 21201.75, 0.5, ROUNDING);

const petra = sheetResult.memberLines.find((l) => l.memberId === PETRA)!;
const anton = sheetResult.memberLines.find((l) => l.memberId === ANTON)!;
check('Petra pays directly', petra.paidDirectly, 377);
check('Anton pays directly', anton.paidDirectly, 1044.67);
check('Petra to transfer', petra.toTransfer, 16308.25, 0.5, ROUNDING);
check('Anton to transfer', anton.toTransfer, 25753.58, 0.5, ROUNDING);
// The rule is equal money left over. The sheet shows 21 199 / 21 200 due to rounding.
check('Petra left over', petra.leftOver, 21201.75, 0.5);
check('Anton left over', anton.leftOver, 21201.75, 0.5);
check('Left over is equal', Math.abs(petra.leftOver - anton.leftOver), 0, 0.001);

console.log('\n— Using the real 2.6% nominal —');
const realResult = calculateMonth(buildBudget(0.026), MONTH);
const realInterest = realResult.loanLines.reduce((s, l) => s + l.interest, 0);
console.log(`  Effective rate               ${(effectiveRate(0.026) * 100).toFixed(4)} %`);
console.log(`  Interest                     ${realInterest.toFixed(2)}`);
console.log(`  Loans this month             ${realResult.loanTotal.toFixed(2)}`);
console.log(
  `  Difference vs sheet          ${(sheetResult.loanTotal - realResult.loanTotal).toFixed(2)} kr/month`,
);
console.log(`  Surplus per member           ${realResult.surplusPerMember.toFixed(2)}`);

console.log('\n— Joint account cash flow —');
for (const point of forecast(sheetBudget, 4)) {
  console.log(
    `  ${point.month}  in ${point.inflow.toFixed(0).padStart(7)}` +
      `  out ${point.outflow.toFixed(0).padStart(7)}  balance ${point.closing.toFixed(0).padStart(8)}`,
  );
}

// A one-off purchase should dip the balance when paid and recover as it is repaid.
const withPurchase: Budget = {
  ...sheetBudget,
  oneOffCosts: [
    { id: 'e1', description: 'Washing machine', total: 13500, start: '2026-09', end: '2026-12' },
  ],
};
console.log('\n— With a 13 500 washing machine in Sep, repaid by Dec —');
for (const point of forecast(withPurchase, 5)) {
  console.log(
    `  ${point.month}  in ${point.inflow.toFixed(0).padStart(7)}` +
      `  out ${point.outflow.toFixed(0).padStart(7)}  balance ${point.closing.toFixed(0).padStart(8)}`,
  );
}

/* ---------- Dated loan terms ---------- */

console.log('\n— A rate change applies forward only —');

const rateChanged: Budget = {
  ...sheetBudget,
  loans: sheetBudget.loans.map((loan) =>
    loan.id === sheetBudget.loans[0].id
      ? { ...loan, terms: [{ from: '2026-09', nominalRate: 0.036 }] }
      : loan,
  ),
};

for (const month of ['2026-08', '2026-09'] as const) {
  const before = calculateMonth(sheetBudget, month).loanLines[0].interest;
  const after = calculateMonth(rateChanged, month).loanLines[0].interest;
  const shouldMove = month >= '2026-09';
  const moved = Math.abs(after - before) > 0.01;
  expect(
    `${month}: interest ${shouldMove ? 'follows the new rate' : 'is untouched by a later change'}`,
    moved,
    shouldMove,
  );
}

console.log('\n— A charge change applies forward only —');

const chargeChanged: Budget = {
  ...sheetBudget,
  recurringCosts: sheetBudget.recurringCosts.map((cost, i) =>
    i === 0 ? { ...cost, terms: [{ from: '2026-09', amount: cost.amount * 2 }] } : cost,
  ),
};

for (const month of ['2026-08', '2026-09'] as const) {
  const before = calculateMonth(sheetBudget, month).recurringTotal;
  const after = calculateMonth(chargeChanged, month).recurringTotal;
  const shouldMove = month >= '2026-09';
  expect(
    `${month}: shared costs ${shouldMove ? 'follow the new amount' : 'are untouched by a later change'}`,
    Math.abs(after - before) > 0.01,
    shouldMove,
  );
}

console.log('\n— Savings —');

const withSavings: Budget = {
  ...sheetBudget,
  savings: [
    { id: 's1', memberId: 'm1', name: 'Pension', amount: 4000 },
    // Paused from September, so it counts in August and not after.
    {
      id: 's2',
      memberId: 'm1',
      name: 'Fond',
      amount: 1000,
      periods: [{ to: '2026-09' }],
      terms: [{ from: '2026-09', amount: 2500 }],
    },
  ],
};

expect('August counts both savings', savingsTotal(withSavings, '2026-08') === 5000, true);
expect('September drops the paused one', savingsTotal(withSavings, '2026-09') === 4000, true);
expect('the split is untouched by savings',
  calculateMonth(withSavings, MONTH).surplusPerMember ===
    calculateMonth(sheetBudget, MONTH).surplusPerMember,
  true);

console.log('\n— The household split rule —');
{
  // Same month, same money, three positions on what fair means.
  const withRule = (split: SplitRule) => {
    const budget = { ...sheetBudget, household: { ...sheetBudget.household, split } };
    const result = calculateMonth(budget, MONTH);
    return {
      petra: result.memberLines.find((l) => l.memberId === PETRA)!,
      anton: result.memberLines.find((l) => l.memberId === ANTON)!,
      costs: result.totalCosts,
    };
  };

  const equal = withRule('equalLeftover');
  check('equal: absent rule is the same as equalLeftover', equal.anton.toTransfer, anton.toTransfer, 0.001);

  const byIncome = withRule('byIncome');
  // Petra earns 37 887 of 85 887, so she carries 44.11% of the 43 483.50 in costs.
  check('byIncome: Petra carries her income share', byIncome.petra.costShare, 19181.71, 0.5);
  check('byIncome: Anton carries the rest', byIncome.anton.costShare, 24301.79, 0.5);
  check(
    'byIncome: leftovers stay in proportion',
    byIncome.petra.leftOver / byIncome.anton.leftOver,
    37887 / 48000,
    0.001,
  );

  const even = withRule('even');
  check('even: each carries half the costs', even.petra.costShare, even.costs / 2, 0.001);
  // Equal shares of the costs leave the income gap exactly as it was.
  check('even: the gap is the income gap', even.anton.leftOver - even.petra.leftOver, 48000 - 37887, 0.001);

  // Whoever pays what, the joint account must still receive exactly what is owed.
  for (const [name, r] of [['equalLeftover', equal], ['byIncome', byIncome], ['even', even]] as const) {
    const transferred = r.petra.toTransfer + r.anton.toTransfer;
    const paidDirectly = r.petra.paidDirectly + r.anton.paidDirectly;
    check(`${name}: transfers plus direct payments cover the costs`, transferred + paidDirectly, r.costs, 0.001);
  }
}

console.log('\n— The buffer —');
{
  const goalMonths = 2;
  const withGoal = {
    ...sheetBudget,
    household: { ...sheetBudget.household, bufferMonths: goalMonths },
  };

  // Recurring plus loans, averaged over a year. One-off costs are excluded, so
  // adding one must not move the goal.
  const average = averageCommitment(withGoal, MONTH);
  check('average commitment excludes one-off costs', averageCommitment({
    ...withGoal,
    oneOffCosts: [{ id: 'x', description: 'Soffa', total: 30000, start: MONTH, end: addMonths(MONTH, 10), payerId: undefined }],
  }, MONTH), average, 0.001);

  check('goal is that many months of it', bufferGoal(withGoal, MONTH), average * goalMonths, 0.001);
  // Absent is the default of one month, not none. Zero is the deliberate none.
  check('absent means one month', bufferGoal(sheetBudget, MONTH), average, 0.001);
  check('zero means none', bufferGoal({
    ...sheetBudget,
    household: { ...sheetBudget.household, bufferMonths: 0 },
  }, MONTH), 0, 0.001);

  /*
   * The share is the product of how good the month was and how much room is left,
   * so the four corners are what matter. Normal income is 100 000 throughout, and
   * the goal 100 000, which makes the fractions easy to read.
   */
  const NORMAL = 100000;

  /** A month with plenty left, so the surplus is never the binding cap. */
  const RICH = 1000000;

  // Barely over, empty account: a couple of percent of the difference.
  check('a small excess gives a small share', bufferTopUp(100000, 0, 5000, NORMAL, RICH), 100, 0.001);

  // Half again as much as normal, empty account: the full quarter.
  check('a big excess on an empty buffer gives the most', bufferTopUp(100000, 0, 50000, NORMAL, RICH), 12500, 0.001);

  // The same big month against a nearly full buffer takes far less.
  check('the same month takes less when nearly full', bufferTopUp(100000, 90000, 50000, NORMAL, RICH), 1200, 0.001);

  // A small excess against a nearly full buffer rounds away to nothing, which is
  // the case that would otherwise need naming.
  check('small excess and nearly full takes nothing', bufferTopUp(100000, 90000, 5000, NORMAL, RICH), 0, 0.001);

  check('nothing when the month was normal', bufferTopUp(100000, 0, 0, NORMAL, RICH), 0, 0.001);
  check('nothing once the goal is met', bufferTopUp(100000, 100000, 12000, NORMAL, RICH), 0, 0.001);
  check('nothing past the goal', bufferTopUp(100000, 150000, 12000, NORMAL, RICH), 0, 0.001);
  // The room factor usually gets there first, but a windfall large enough to
  // overshoot on its own is still capped at what is missing.
  check('never more than the gap', bufferTopUp(100000, 0, 1000000, NORMAL, RICH), 100000, 0.001);
  check('nothing without a goal', bufferTopUp(0, 0, 50000, NORMAL, RICH), 0, 0.001);

  // Earning above normal and having something spare are not the same thing.
  check('nothing when the month has nothing left', bufferTopUp(100000, 0, 50000, NORMAL, 0), 0, 0.001);
  check('nothing when the month ends in the red', bufferTopUp(100000, 0, 50000, NORMAL, -8000), 0, 0.001);
  check('never more than the month can spare', bufferTopUp(100000, 0, 50000, NORMAL, 3000), 3000, 0.001);
  // Floored, so a cap can never be exceeded by the rounding meant to tidy it.
  check('and floored rather than rounded up to it', bufferTopUp(100000, 0, 50000, NORMAL, 3050), 3000, 0.001);

  // More of a good month is always worth more, and a fuller buffer always takes
  // less: the curve never doubles back on itself.
  let previous = -1;
  let rising = true;
  for (let excess = 0; excess <= 60000; excess += 2000) {
    const value = bufferTopUp(100000, 20000, excess, NORMAL, RICH);
    if (value < previous) rising = false;
    previous = value;
  }
  check('more excess never sets aside less', rising ? 1 : 0, 1, 0);

  let falling = true;
  previous = Number.MAX_SAFE_INTEGER;
  for (let balance = 0; balance <= 100000; balance += 5000) {
    const value = bufferTopUp(100000, balance, 30000, NORMAL, RICH);
    if (value > previous) falling = false;
    previous = value;
  }
  check('a fuller buffer never sets aside more', falling ? 1 : 0, 1, 0);

  // A good month is the household coming in above its normal income, not one
  // person doing well while the other does not.
  const good = {
    ...sheetBudget,
    income: [
      { memberId: ANTON, month: MONTH, amount: 58000, enteredById: null },
      { memberId: PETRA, month: MONTH, amount: 37887, enteredById: null },
    ],
  };
  check('excess is measured on the household', incomeAboveNormal(good, MONTH), 10000, 0.001);

  const mixed = {
    ...sheetBudget,
    income: [
      { memberId: ANTON, month: MONTH, amount: 58000, enteredById: null },
      { memberId: PETRA, month: MONTH, amount: 27887, enteredById: null },
    ],
  };
  check('one good and one bad is not a good month', incomeAboveNormal(mixed, MONTH), 0, 0.001);
  check('an estimated month is never a good one', incomeAboveNormal(sheetBudget, MONTH), 0, 0.001);

  // What is set aside is shared like any other cost, and lands in the account.
  const plain = calculateMonth(sheetBudget, MONTH);
  const topped = calculateMonth(sheetBudget, MONTH, 2000);
  check('the top-up is added to the costs', topped.totalCosts - plain.totalCosts, 2000, 0.001);

  /*
   * A month that has already gone well lifts every point after it, while the
   * months ahead assume nothing: they are estimated at normal income and so are
   * never good ones.
   */
  {
    const base = {
      ...withGoal,
      accountBalance: { month: MONTH, amount: 10000 },
    };
    const flat = forecast(base, 6);

    const goodMonth = {
      ...base,
      income: [
        { memberId: ANTON, month: MONTH, amount: 78000, enteredById: null },
        { memberId: PETRA, month: MONTH, amount: 37887, enteredById: null },
      ],
    };
    const lifted = forecast(goodMonth, 6);
    const setAside = lifted[0].bufferTopUp;

    check('a good month sets something aside', setAside > 0 ? 1 : 0, 1, 0);
    check('nothing is set aside in the months ahead', lifted.slice(1).reduce((n, p) => n + p.bufferTopUp, 0), 0, 0.001);
    check('the month it happened closes higher', lifted[0].closing - flat[0].closing, setAside, 0.001);
    check('and so does every month after it', lifted[5].closing - flat[5].closing, setAside, 0.001);

    // Skipping the month puts the line back exactly where it was.
    const skipped = forecast({
      ...goodMonth,
      household: { ...goodMonth.household, bufferSkipped: [MONTH] },
    }, 6);
    check('skipping sets nothing aside', skipped[0].bufferTopUp, 0, 0.001);
    check('and leaves the line where it was', skipped[5].closing, flat[5].closing, 0.001);

    // A skip reports what it turned down, so undoing it has something to restore.
    check('a skipped month says what it declined', skipped[0].bufferDeclined, setAside, 0.001);

    /*
     * The month that motivated the cap: income well above normal, and a one-off
     * large enough that it still ends in the red. Earning more than usual is not
     * the same as having anything spare.
     */
    const expensive = {
      ...goodMonth,
      oneOffCosts: [
        { id: 'roof', description: 'Tak', total: 200000, start: MONTH, end: addMonths(MONTH, 1), payerId: undefined },
      ],
    };
    const drowning = forecast(expensive, 3);
    check('the month is under water', calculateMonth(expensive, MONTH).surplus < 0 ? 1 : 0, 1, 0);
    check('and sets nothing aside', drowning[0].bufferTopUp, 0, 0.001);

    // Tight rather than drowning: it gives what it has and no more.
    const tight = {
      ...goodMonth,
      oneOffCosts: [
        { id: 'kok', description: 'Kök', total: 41500, start: MONTH, end: addMonths(MONTH, 1), payerId: undefined },
      ],
    };
    const squeezed = forecast(tight, 3);
    const left = calculateMonth(tight, MONTH).surplus;
    check('a tight month gives no more than it has', squeezed[0].bufferTopUp <= left ? 1 : 0, 1, 0);

    // A month that would have set nothing aside has nothing to undo, even if it
    // is on the list: the goal was turned off after the fact here.
    const pointless = forecast({
      ...goodMonth,
      household: { ...goodMonth.household, bufferMonths: 0, bufferSkipped: [MONTH] },
    }, 6);
    check('nothing to undo when there was nothing to skip', pointless[0].bufferDeclined, 0, 0.001);
  }
  check('and to what reaches the account', topped.jointInflow - plain.jointInflow, 2000, 0.001);
  check('leaving that much less over', plain.surplus - topped.surplus, 2000, 0.001);
}

console.log('\n— A one-off taken out of the buffer —');
{
  const month = MONTH;
  const base = {
    ...sheetBudget,
    household: { ...sheetBudget.household, bufferMonths: 2 },
    accountBalance: { month, amount: 60000 },
  };

  const repaid = {
    ...base,
    oneOffCosts: [
      { id: 'k', description: 'Kök', total: 30000, start: month, end: addMonths(month, 10), payerId: undefined },
    ],
  };
  const absorbed = {
    ...base,
    oneOffCosts: [{ ...repaid.oneOffCosts[0], fromBuffer: true }],
  };

  const a = calculateMonth(repaid, month);
  const b = calculateMonth(absorbed, month);

  // Nobody repays it, so it is in nobody's share and nobody's transfer.
  check('a repaid one-off is charged monthly', a.oneOffTotal, 3000, 0.001);
  check('an absorbed one-off is charged to no one', b.oneOffTotal, 0, 0.001);
  check('and so does not move the transfers', b.jointInflow, calculateMonth(base, month).jointInflow, 0.001);

  // It is still spent, and still reported.
  check('but it is reported for the month it lands', b.oneOffAbsorbed, 30000, 0.001);
  check('and only in that month', calculateMonth(absorbed, addMonths(month, 1)).oneOffAbsorbed, 0, 0.001);

  // The account pays it either way, so the balance drops either way.
  const withRepaid = forecast(repaid, 3);
  const withAbsorbed = forecast(absorbed, 3);
  check('the account pays it out in full', withAbsorbed[0].outflow - forecast(base, 3)[0].outflow, 30000, 0.001);

  // The difference is what happens next: repaying puts it back, absorbing does not.
  check('a repaid one-off comes back to the account', withRepaid[2].closing > withAbsorbed[2].closing ? 1 : 0, 1, 0);
}

console.log('\n— A loan does not exist before it was taken out —');

const started: Budget = {
  ...sheetBudget,
  loans: sheetBudget.loans.map((loan, i) =>
    i === 0 ? { ...loan, started: '2026-01' } : { ...loan, started: '2020-01' },
  ),
};

for (const month of ['2025-06', '2026-06'] as const) {
  const line = calculateMonth(started, month).loanLines[0];
  const present = line.debt > 0.005;
  expect(
    `${month}: the loan ${present ? 'carries debt' : 'has none yet'}`,
    present,
    month >= '2026-01',
  );
  expect(
    `${month}: interest ${present ? 'is charged' : 'is not charged'}`,
    line.interest > 0.005,
    month >= '2026-01',
  );
}

console.log('\n— An amortization change applies forward only —');

const amortChanged: Budget = {
  ...sheetBudget,
  amortizationStreams: sheetBudget.amortizationStreams.map((stream, i) =>
    i === 0 ? { ...stream, terms: [{ from: '2026-09', amount: stream.amount * 2 }] } : stream,
  ),
};

// Debt at a month is the walk up to it, so a later change must not move an earlier point.
const debtAt = (b: Budget, month: string) =>
  [...debtAtStartOf(b, month).values()].reduce((sum, d) => sum + d, 0);

for (const month of ['2026-09', '2026-12'] as const) {
  const moved = Math.abs(debtAt(amortChanged, month) - debtAt(sheetBudget, month)) > 0.01;
  expect(
    `${month}: debt ${moved ? 'reflects the larger amortization' : 'is untouched'}`,
    moved,
    month > '2026-09',
  );
}

/* ---------- Monthly income prompt ---------- */

function expect(label: string, actual: boolean, want: boolean) {
  const ok = actual === want;
  if (!ok) failures++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}`);
}

console.log('\n— Monthly income prompt —');

const base = buildBudget(0.026);
const admin = base.members[0];
const member = base.members[1];

expect(
  'no prompt before the 8th',
  shouldPromptForIncome(base, ANTON, MONTH, 7),
  false,
);
expect('prompts from the 8th', shouldPromptForIncome(base, ANTON, MONTH, 8), true);
expect('prompts later in the month', shouldPromptForIncome(base, ANTON, MONTH, 25), true);

const confirmed: Budget = {
  ...base,
  income: [{ memberId: ANTON, month: MONTH, amount: 48000 }],
};
expect(
  'stops once confirmed',
  shouldPromptForIncome(confirmed, ANTON, MONTH, 15),
  false,
);
expect(
  'still asks the other member',
  shouldPromptForIncome(confirmed, PETRA, MONTH, 15),
  true,
);

// Closing the banner is component state that lasts for the session, so it does not
// appear here and never suppresses the reminder emails.

// An admin filling in on someone's behalf counts as answered for them.
const filledByAdmin: Budget = {
  ...base,
  income: [{ memberId: PETRA, month: MONTH, amount: 37887, enteredById: ANTON }],
};
expect(
  'admin entry suppresses that member’s prompt',
  shouldPromptForIncome(filledByAdmin, PETRA, MONTH, 15),
  false,
);

expect('you may edit your own', canEditIncomeFor(member, PETRA), true);
expect('a member may not edit another', canEditIncomeFor(member, ANTON), false);
expect('an admin may edit anyone', canEditIncomeFor(admin, PETRA), true);

check('awaiting confirmation', membersAwaitingIncome(confirmed, MONTH).length, 1, 0);

const history = incomeHistory(confirmed, MONTH);
check('history covers 6 months minimum', history.length, 6, 0);
expect('newest row first', history[0].month === MONTH, true);
expect('confirmed figure marked', history[0].entries[0].confirmed, true);
expect('fallback figure marked as estimate', history[0].entries[1].confirmed, false);
expect('partially confirmed month is not complete', history[0].fullyConfirmed, false);
check(
  'estimate falls back to baseline',
  history[1].entries[0].amount,
  48000,
  0,
);

console.log(failures === 0 ? '\nAll checks pass.\n' : `\n${failures} checks failed.\n`);
process.exit(failures === 0 ? 0 : 1);
