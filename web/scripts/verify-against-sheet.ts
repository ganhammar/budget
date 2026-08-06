/**
 * Checks that the engine reproduces the numbers from the original spreadsheet.
 * Run with: npx tsx scripts/verify-against-sheet.ts
 *
 * Where the engine and the sheet disagree, the sheet is the one that is wrong:
 * it applies ROUNDUP to each loan's interest, inflating the total by 3.72 kr/month.
 */
import type { Budget, RecurringCost } from '../src/domain/types';
import { calculateMonth, effectiveRate, forecast, savingsTotal } from '../src/domain/engine';
import {
  canEditIncomeFor,
  incomeHistory,
  membersAwaitingIncome,
  shouldPromptForIncome,
} from '../src/domain/income';

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
