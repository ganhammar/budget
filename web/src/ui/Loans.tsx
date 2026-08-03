import { useState } from 'react';
import { useBudget, newId } from '../store/store';
import { RATE_FIXATIONS, type AmortizationStream, type Loan, type RateFixation } from '../domain/types';
import { calculateMonth, debtFreeMonth, effectiveRate } from '../domain/engine';
import { percent, sek } from '../domain/format';
import { currentMonth, formatMonth, formatMonthShort } from '../domain/month';
import { AmountInput, Card, Empty, Field, ListRow, MonthInput, Note, PayerSelect, Sheet, Stat } from './components';

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
  const [loanDraft, setLoanDraft] = useState<Loan | null>(null);
  const [streamDraft, setStreamDraft] = useState<AmortizationStream | null>(null);
  const [isNew, setIsNew] = useState(false);

  const result = calculateMonth(budget, currentMonth());
  const totalDebt = result.loanLines.reduce((sum, l) => sum + l.debt, 0);
  const totalInterest = result.loanLines.reduce((sum, l) => sum + l.interest, 0);
  const totalAmortization = result.loanLines.reduce((sum, l) => sum + l.amortization, 0);
  const debtFree = debtFreeMonth(budget);

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
      <Card title="Lån totalt">
        <div className="stat-grid">
          <Stat label="Total skuld" value={sek(totalDebt)} />
          <Stat label="Denna månad" value={sek(totalInterest + totalAmortization)} />
          <Stat label="Varav ränta" value={sek(totalInterest)} />
          <Stat label="Varav amortering" value={sek(totalAmortization)} />
        </div>
        {debtFree && (
          <div style={{ marginTop: 12 }}>
            <Note>Skuldfri {formatMonth(debtFree)} med nuvarande amortering.</Note>
          </div>
        )}
      </Card>

      <Card
        title="Lån"
        action={
          <button
            className="btn btn-small"
            onClick={() => {
              setLoanDraft(blankLoan());
              setIsNew(true);
            }}
          >
            Lägg till
          </button>
        }
      >
        {budget.loans.length === 0 && <Empty text="Inga lån inlagda än." />}
        <div className="list">
          {result.loanLines.map((line) => (
            <ListRow
              key={line.loan.id}
              title={line.loan.description}
              badge={memberName(line.loan.payerId)}
              subtitle={`${sek(line.debt)} · ${percent(line.loan.nominalRate)} nom · ränta ${sek(line.interest)}${line.amortization > 0 ? ` · amort ${sek(line.amortization)}` : ''}`}
              amount={sek(line.total)}
              amountNote="/mån"
              onClick={() => {
                setLoanDraft({ ...line.loan });
                setIsNew(false);
              }}
            />
          ))}
        </div>
      </Card>

      <Card
        title="Amortering"
        action={
          <button
            className="btn btn-small"
            onClick={() => {
              setStreamDraft(blankStream());
              setIsNew(true);
            }}
          >
            Lägg till
          </button>
        }
      >
        <div style={{ marginBottom: 12 }}>
          <Note>
            <strong>Parallell</strong> delar beloppet lika mellan lånen. <strong>Prioritet</strong>{' '}
            betar av ett lån i taget och flyttar hela beloppet till nästa när ett är slutbetalt.
          </Note>
        </div>
        {budget.amortizationStreams.length === 0 && <Empty text="Ingen amortering inlagd." />}
        <div className="list">
          {budget.amortizationStreams.map((stream) => (
            <ListRow
              key={stream.id}
              title={stream.name}
              badge={stream.mode === 'parallel' ? 'Parallell' : 'Prioritet'}
              subtitle={`Från ${formatMonthShort(stream.start)} · ${stream.loanIds
                .map((id) => budget.loans.find((l) => l.id === id)?.description)
                .filter(Boolean)
                .join(stream.mode === 'priority' ? ' → ' : ' + ')}`}
              amount={sek(stream.amount)}
              amountNote="/mån"
              onClick={() => {
                setStreamDraft({ ...stream, loanIds: [...stream.loanIds] });
                setIsNew(false);
              }}
            />
          ))}
        </div>
      </Card>

      {loanDraft && (
        <Sheet title={isNew ? 'Nytt lån' : 'Ändra lån'} onClose={() => setLoanDraft(null)}>
          <Field label="Beskrivning">
            <input
              autoFocus
              value={loanDraft.description}
              onChange={(e) => setLoanDraft({ ...loanDraft, description: e.target.value })}
              placeholder="t.ex. Huslån del 1"
            />
          </Field>
          <div className="field-pair">
            <Field label="Ursprunglig skuld">
              <AmountInput
                value={loanDraft.originalDebt || ''}
                onChange={(v) => setLoanDraft({ ...loanDraft, originalDebt: v })}
              />
            </Field>
            <Field label="Nominell ränta (%)">
              <AmountInput
                step={0.01}
                value={loanDraft.nominalRate ? Number((loanDraft.nominalRate * 100).toFixed(4)) : ''}
                onChange={(v) => setLoanDraft({ ...loanDraft, nominalRate: v / 100 })}
              />
            </Field>
          </div>
          <div className="field-pair">
            <Field label="Räntebindning">
              <select
                value={loanDraft.fixation}
                onChange={(e) =>
                  setLoanDraft({ ...loanDraft, fixation: e.target.value as RateFixation })
                }
              >
                {RATE_FIXATIONS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Villkorsändringsdag">
              <MonthInput
                value={loanDraft.resetDate ?? ''}
                onChange={(v) => setLoanDraft({ ...loanDraft, resetDate: v || undefined })}
              />
            </Field>
          </div>
          <Field label="Betalas av">
            <PayerSelect
              members={budget.members}
              value={loanDraft.payerId}
              onChange={(payerId) => setLoanDraft({ ...loanDraft, payerId })}
            />
          </Field>

          {loanDraft.nominalRate > 0 && (
            <Note>
              {percent(loanDraft.nominalRate)} nominellt motsvarar{' '}
              <strong>{percent(effectiveRate(loanDraft.nominalRate))} effektivt</strong> med
              månadsvis kapitalisering. Budgeten räknar räntan på den nominella satsen.
            </Note>
          )}

          <div className="btn-row">
            {!isNew && (
              <button className="btn btn-danger" onClick={removeLoan}>
                Ta bort
              </button>
            )}
            <button className="btn" onClick={saveLoan}>
              Spara
            </button>
          </div>
        </Sheet>
      )}

      {streamDraft && (
        <Sheet
          title={isNew ? 'Ny amortering' : 'Ändra amortering'}
          onClose={() => setStreamDraft(null)}
        >
          <Field label="Namn">
            <input
              autoFocus
              value={streamDraft.name}
              onChange={(e) => setStreamDraft({ ...streamDraft, name: e.target.value })}
              placeholder="t.ex. Huslån"
            />
          </Field>
          <div className="field-pair">
            <Field label="Belopp per månad">
              <AmountInput
                value={streamDraft.amount || ''}
                onChange={(v) => setStreamDraft({ ...streamDraft, amount: v })}
              />
            </Field>
            <Field label="Startade">
              <MonthInput
                value={streamDraft.start}
                onChange={(v) => setStreamDraft({ ...streamDraft, start: v })}
              />
            </Field>
          </div>
          <Field label="Fördelning">
            <select
              value={streamDraft.mode}
              onChange={(e) =>
                setStreamDraft({ ...streamDraft, mode: e.target.value as 'parallel' | 'priority' })
              }
            >
              <option value="parallel">Parallell (dela lika)</option>
              <option value="priority">Prioritet (ett i taget, i ordning)</option>
            </select>
          </Field>
          <Field
            label="Lån"
            hint={
              streamDraft.mode === 'priority'
                ? 'Klicka i den ordning de ska betas av.'
                : 'Beloppet delas lika mellan valda lån.'
            }
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
                Ta bort
              </button>
            )}
            <button className="btn" onClick={saveStream}>
              Spara
            </button>
          </div>
        </Sheet>
      )}
    </>
  );
}
