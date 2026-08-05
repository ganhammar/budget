import { useMemo, useState } from 'react';
import { useBudget, newId } from '../store/store';
import { RATE_FIXATIONS, type AmortizationStream, type Loan, type RateFixation } from '../domain/types';
import {
  calculateMonth,
  debtFreeMonth,
  debtOverTime,
  effectiveRate,
  payoffMonths,
} from '../domain/engine';
import { percent, sek } from '../domain/format';
import { currentMonth, formatMonth, formatMonthShort, monthsBetween } from '../domain/month';
import { DebtChart, DebtTable } from './DebtChart';
import {
  AmountInput,
  Card,
  Empty,
  Field,
  ListRow,
  MonthInput,
  MultiSelect,
  Note,
  PayerSelect,
  Sheet,
  Stat,
} from './components';
import { fixationLabel, useText } from '../i18n';

function blankLoan(): Loan {
  return {
    id: newId(),
    description: '',
    originalDebt: 0,
    nominalRate: 0.026,
    fixation: 'floating3m',
  };
}

function blankStream(): AmortizationStream {
  return { id: newId(), name: '', amount: 0, start: currentMonth(), mode: 'parallel', loanIds: [] };
}

export function Loans() {
  const { budget, update } = useBudget();
  const t = useText();
  const [loanDraft, setLoanDraft] = useState<Loan | null>(null);
  const [streamDraft, setStreamDraft] = useState<AmortizationStream | null>(null);
  const [isNew, setIsNew] = useState(false);
  // Empty means all, so loans added later are included without touching this.
  const [hidden, setHidden] = useState<string[]>([]);
  const [showDebtTable, setShowDebtTable] = useState(false);

  const nowMonth = currentMonth();
  const debtFree = debtFreeMonth(budget);

  const shown = budget.loans.filter((l) => !hidden.includes(l.id));
  const colorIndex = useMemo(
    () => Object.fromEntries(budget.loans.map((l, i) => [l.id, i])),
    [budget.loans],
  );
  const payoff = useMemo(() => payoffMonths(budget), [budget]);

  // Run to payoff when it is known, so the rollover between loans is visible,
  // with a ceiling for the case where nothing is being amortized.
  const debtPoints = useMemo(() => {
    if (budget.loans.length === 0) return [];
    const span = debtFree ? monthsBetween(nowMonth, debtFree) + 2 : 120;
    return debtOverTime(budget, nowMonth, Math.max(12, Math.min(span, 480)));
  }, [budget, nowMonth, debtFree]);

  const result = calculateMonth(budget, nowMonth);
  const totalDebt = result.loanLines.reduce((sum, l) => sum + l.debt, 0);
  const totalInterest = result.loanLines.reduce((sum, l) => sum + l.interest, 0);
  const totalAmortization = result.loanLines.reduce((sum, l) => sum + l.amortization, 0);

  const memberName = (id?: string) => budget.members.find((m) => m.id === id)?.name;

  function saveLoan() {
    if (!loanDraft || !loanDraft.description.trim()) return;
    update((b) => ({
      ...b,
      loans: isNew
        ? [...b.loans, loanDraft]
        : b.loans.map((l) => (l.id === loanDraft.id ? loanDraft : l)),
    }));
    setLoanDraft(null);
  }

  function removeLoan() {
    if (!loanDraft) return;
    update((b) => ({
      ...b,
      loans: b.loans.filter((l) => l.id !== loanDraft.id),
      amortizationStreams: b.amortizationStreams.map((s) => ({
        ...s,
        loanIds: s.loanIds.filter((id) => id !== loanDraft.id),
      })),
    }));
    setLoanDraft(null);
  }

  function saveStream() {
    if (!streamDraft || !streamDraft.name.trim()) return;
    update((b) => ({
      ...b,
      amortizationStreams: isNew
        ? [...b.amortizationStreams, streamDraft]
        : b.amortizationStreams.map((s) => (s.id === streamDraft.id ? streamDraft : s)),
    }));
    setStreamDraft(null);
  }

  function removeStream() {
    if (!streamDraft) return;
    update((b) => ({
      ...b,
      amortizationStreams: b.amortizationStreams.filter((s) => s.id !== streamDraft.id),
    }));
    setStreamDraft(null);
  }

  return (
    <>
      <Card title={t.loansTotal}>
        <div className="stat-grid">
          <Stat label={t.totalDebt} value={sek(totalDebt)} />
          <Stat label={t.thisMonthLabel} value={sek(totalInterest + totalAmortization)} />
          <Stat label={t.ofWhichInterest} value={sek(totalInterest)} />
          <Stat label={t.ofWhichAmortization} value={sek(totalAmortization)} />
        </div>
        {debtFree && (
          <div style={{ marginTop: 12 }}>
            <Note>{t.debtFreeIn(formatMonth(debtFree))}</Note>
          </div>
        )}
      </Card>

      {debtPoints.length > 1 && (
        <Card
          title={t.debtOverTime}
          action={
            <button
              className="btn btn-small btn-secondary"
              onClick={() => setShowDebtTable((v) => !v)}
            >
              {showDebtTable ? t.chart : t.table}
            </button>
          }
        >
          <MultiSelect
            label={t.showLoans}
            allLabel={t.allLoans}
            hint={t.newLoansShown}
            options={budget.loans.map((l) => ({ value: l.id, label: l.description }))}
            selected={shown.map((l) => l.id)}
            onChange={(chosen) =>
              setHidden(budget.loans.filter((l) => !chosen.includes(l.id)).map((l) => l.id))
            }
          />

          {shown.length === 0 ? (
            <Empty text={t.pickOneLoan} />
          ) : showDebtTable ? (
            <DebtTable points={debtPoints} loans={shown} />
          ) : (
            <DebtChart
              points={debtPoints}
              loans={shown}
              colorIndex={colorIndex}
              payoff={payoff}
            />
          )}
        </Card>
      )}

      <Card
        title={t.loans}
        action={
          <button
            className="btn btn-small"
            onClick={() => {
              setLoanDraft(blankLoan());
              setIsNew(true);
            }}
          >
            {t.add}
          </button>
        }
      >
        {budget.loans.length === 0 && <Empty text={t.noLoans} />}
        <div className="list">
          {result.loanLines.map((line) => (
            <ListRow
              key={line.loan.id}
              title={line.loan.description}
              badge={memberName(line.loan.payerId)}
              subtitle={`${sek(line.debt)} · ${percent(line.loan.nominalRate)} ${t.nominalShort} · ${t.interest} ${sek(line.interest)}${
                line.amortization > 0 ? ` · ${t.amortizationShort} ${sek(line.amortization)}` : ''
              } · ${
                payoff[line.loan.id]
                  ? t.paidOffIn(formatMonthShort(payoff[line.loan.id]!))
                  : t.notAmortized
              }`}
              amount={sek(line.total)}
              amountNote={t.perMonth}
              onClick={() => {
                setLoanDraft({ ...line.loan });
                setIsNew(false);
              }}
            />
          ))}
        </div>
      </Card>

      <Card
        title={t.amortization}
        action={
          <button
            className="btn btn-small"
            onClick={() => {
              setStreamDraft(blankStream());
              setIsNew(true);
            }}
          >
            {t.add}
          </button>
        }
      >
        <div style={{ marginBottom: 12 }}>
          <Note>
            <strong>{t.parallel}</strong>
            {t.amortizationSplits}
            <strong>{t.priority}</strong>
            {t.amortizationRolls}
          </Note>
        </div>
        {budget.amortizationStreams.length === 0 && <Empty text={t.noAmortization} />}
        <div className="list">
          {budget.amortizationStreams.map((stream) => (
            <ListRow
              key={stream.id}
              title={stream.name}
              badge={stream.mode === 'parallel' ? t.parallel : t.priority}
              subtitle={`${t.from} ${formatMonthShort(stream.start)} · ${stream.loanIds
                .map((id) => budget.loans.find((l) => l.id === id)?.description)
                .filter(Boolean)
                .join(stream.mode === 'priority' ? ' → ' : ' + ')}`}
              amount={sek(stream.amount)}
              amountNote={t.perMonth}
              onClick={() => {
                setStreamDraft({ ...stream, loanIds: [...stream.loanIds] });
                setIsNew(false);
              }}
            />
          ))}
        </div>
      </Card>

      {loanDraft && (
        <Sheet title={isNew ? t.newLoan : t.editLoan} onClose={() => setLoanDraft(null)}>
          <Field label={t.description}>
            <input
              autoFocus
              value={loanDraft.description}
              onChange={(e) => setLoanDraft({ ...loanDraft, description: e.target.value })}
              placeholder={t.loanPlaceholder}
            />
          </Field>
          <div className="field-pair">
            <Field label={t.originalDebt}>
              <AmountInput
                value={loanDraft.originalDebt || ''}
                onChange={(v) => setLoanDraft({ ...loanDraft, originalDebt: v })}
              />
            </Field>
            <Field label={t.nominalRate}>
              <AmountInput
                step={0.01}
                value={loanDraft.nominalRate ? Number((loanDraft.nominalRate * 100).toFixed(4)) : ''}
                onChange={(v) => setLoanDraft({ ...loanDraft, nominalRate: v / 100 })}
              />
            </Field>
          </div>
          <div className="field-pair">
            <Field label={t.rateFixation}>
              <select
                value={loanDraft.fixation}
                onChange={(e) =>
                  setLoanDraft({ ...loanDraft, fixation: e.target.value as RateFixation })
                }
              >
                {RATE_FIXATIONS.map((value) => (
                  <option key={value} value={value}>
                    {fixationLabel(t, value)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t.resetDate}>
              <MonthInput
                value={loanDraft.resetDate ?? ''}
                onChange={(v) => setLoanDraft({ ...loanDraft, resetDate: v || undefined })}
              />
            </Field>
          </div>
          <Field label={t.paidBy}>
            <PayerSelect
              members={budget.members}
              value={loanDraft.payerId}
              onChange={(payerId) => setLoanDraft({ ...loanDraft, payerId })}
            />
          </Field>

          {loanDraft.nominalRate > 0 && (
            <Note>
              {t.effectivePrefix(percent(loanDraft.nominalRate))}{' '}
              <strong>{t.effectiveBold(percent(effectiveRate(loanDraft.nominalRate)))}</strong>
              {t.effectiveSuffix}
            </Note>
          )}

          <div className="btn-row">
            {!isNew && (
              <button className="btn btn-danger" onClick={removeLoan}>
                {t.remove}
              </button>
            )}
            <button className="btn" onClick={saveLoan}>
              {t.save}
            </button>
          </div>
        </Sheet>
      )}

      {streamDraft && (
        <Sheet
          title={isNew ? t.newAmortization : t.editAmortization}
          onClose={() => setStreamDraft(null)}
        >
          <Field label={t.name}>
            <input
              autoFocus
              value={streamDraft.name}
              onChange={(e) => setStreamDraft({ ...streamDraft, name: e.target.value })}
              placeholder={t.amortizationPlaceholder}
            />
          </Field>
          <div className="field-pair">
            <Field label={t.amountPerMonth}>
              <AmountInput
                value={streamDraft.amount || ''}
                onChange={(v) => setStreamDraft({ ...streamDraft, amount: v })}
              />
            </Field>
            <Field label={t.started}>
              <MonthInput
                value={streamDraft.start}
                onChange={(v) => setStreamDraft({ ...streamDraft, start: v })}
              />
            </Field>
          </div>
          <Field label={t.allocation}>
            <select
              value={streamDraft.mode}
              onChange={(e) =>
                setStreamDraft({ ...streamDraft, mode: e.target.value as 'parallel' | 'priority' })
              }
            >
              <option value="parallel">{t.parallelOption}</option>
              <option value="priority">{t.priorityOption}</option>
            </select>
          </Field>
          <Field
            label={t.loans}
            hint={streamDraft.mode === 'priority' ? t.priorityHint : t.parallelHint}
          >
            <div className="list">
              {budget.loans.map((loan) => {
                const position = streamDraft.loanIds.indexOf(loan.id);
                return (
                  <button
                    key={loan.id}
                    type="button"
                    className="row"
                    onClick={() =>
                      setStreamDraft({
                        ...streamDraft,
                        loanIds:
                          position >= 0
                            ? streamDraft.loanIds.filter((id) => id !== loan.id)
                            : [...streamDraft.loanIds, loan.id],
                      })
                    }
                  >
                    <span className="row-main">
                      <span className="row-title">{loan.description}</span>
                      <span className="row-sub">{sek(loan.originalDebt)}</span>
                    </span>
                    <span className="row-amount">
                      {position >= 0
                        ? streamDraft.mode === 'priority'
                          ? `${position + 1} ✓`
                          : '✓'
                        : ''}
                    </span>
                  </button>
                );
              })}
            </div>
          </Field>

          <div className="btn-row">
            {!isNew && (
              <button className="btn btn-danger" onClick={removeStream}>
                {t.remove}
              </button>
            )}
            <button className="btn" onClick={saveStream}>
              {t.save}
            </button>
          </div>
        </Sheet>
      )}
    </>
  );
}
