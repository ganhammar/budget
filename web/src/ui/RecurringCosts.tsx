import { useMemo, useState } from 'react';
import { useBudget, newId } from '../store/store';
import { CATEGORIES, INTERVALS, type RecurringCost } from '../domain/types';
import { isCostPaused, monthlyAmount, pausedFrom, upcomingCharges } from '../domain/engine';
import { sek } from '../domain/format';
import { currentMonth, formatMonth, formatMonthShort } from '../domain/month';
import { AmountInput, Card, Empty, Field, ListRow, MonthInput, Note, PayerSelect, Sheet } from './components';

function blank(): RecurringCost {
  return {
    id: newId(),
    category: 'Hus',
    description: '',
    amount: 0,
    intervalMonths: 1,
    firstCharge: currentMonth(),
  };
}

export function RecurringCosts() {
  const { budget, update } = useBudget();
  const [draft, setDraft] = useState<RecurringCost | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [showPaused, setShowPaused] = useState(false);

  const thisMonth = currentMonth();

  const live = budget.recurringCosts.filter((c) => !isCostPaused(c, thisMonth));
  const paused = budget.recurringCosts.filter((c) => isCostPaused(c, thisMonth));

  const groups = useMemo(() => {
    const map = new Map<string, RecurringCost[]>();
    for (const cost of live) {
      map.set(cost.category, [...(map.get(cost.category) ?? []), cost]);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0], 'sv'));
  }, [live]);

  const total = live.reduce((sum, c) => sum + monthlyAmount(c), 0);
  const memberName = (id?: string) => budget.members.find((m) => m.id === id)?.name;

  function save() {
    if (!draft || !draft.description.trim()) return;
    update((b) => ({
      ...b,
      recurringCosts: isNew
        ? [...b.recurringCosts, draft]
        : b.recurringCosts.map((c) => (c.id === draft.id ? draft : c)),
    }));
    setDraft(null);
  }

  /**
   * Closes the open period at this month, so the cost stops counting now but every
   * earlier month keeps it.
   */
  function pause(cost: RecurringCost) {
    const periods = cost.periods && cost.periods.length > 0 ? [...cost.periods] : [{}];
    const last = periods[periods.length - 1];
    if (last.to) return;
    periods[periods.length - 1] = { ...last, to: thisMonth };
    update((b) => ({
      ...b,
      recurringCosts: b.recurringCosts.map((c) => (c.id === cost.id ? { ...c, periods } : c)),
    }));
    setDraft(null);
  }

  /** Opens a fresh period, leaving the gap in place. */
  function resume(cost: RecurringCost) {
    const periods = [...(cost.periods ?? []), { from: thisMonth }];
    update((b) => ({
      ...b,
      recurringCosts: b.recurringCosts.map((c) => (c.id === cost.id ? { ...c, periods } : c)),
    }));
    setDraft(null);
  }

  function remove() {
    if (!draft) return;
    update((b) => ({ ...b, recurringCosts: b.recurringCosts.filter((c) => c.id !== draft.id) }));
    setDraft(null);
  }

  return (
    <>
      <Card
        title={`Gemensamma kostnader · ${sek(total)}/mån`}
        action={
          <button
            className="btn btn-small"
            onClick={() => {
              setDraft(blank());
              setIsNew(true);
            }}
          >
            Lägg till
          </button>
        }
      >
        {live.length === 0 && <Empty text="Inga aktiva kostnader." />}
        {groups.map(([category, costs]) => (
          <div key={category} style={{ marginBottom: 14 }}>
            <div className="group-label">
              {category} · {sek(costs.reduce((sum, c) => sum + monthlyAmount(c), 0))}/mån
            </div>
            <div className="list">
              {costs.map((cost) => {
                const next = upcomingCharges(cost, currentMonth(), 12)[0];
                const interval =
                  INTERVALS.find((i) => i.value === cost.intervalMonths)?.label ??
                  `Var ${cost.intervalMonths}:e månad`;
                return (
                  <ListRow
                    key={cost.id}
                    title={cost.description}
                    badge={memberName(cost.payerId)}
                    subtitle={
                      cost.intervalMonths === 1
                        ? 'Varje månad'
                        : `${sek(cost.amount)} · ${interval.toLowerCase()}${next ? ` · nästa ${formatMonthShort(next)}` : ''}`
                    }
                    amount={sek(monthlyAmount(cost))}
                    amountNote="/mån"
                    onClick={() => {
                      setDraft({ ...cost });
                      setIsNew(false);
                    }}
                  />
                );
              })}
            </div>
          </div>
        ))}
      </Card>

      {paused.length > 0 && (
        <Card
          title={`Pausade · ${paused.length}`}
          action={
            <button
              className="btn btn-small btn-secondary"
              onClick={() => setShowPaused((v) => !v)}
            >
              {showPaused ? 'Dölj' : 'Visa'}
            </button>
          }
        >
          {showPaused && (
            <>
              <Note>
                Pausade kostnader räknas inte längre, men finns kvar i månaderna de
                faktiskt betalades.
              </Note>
              <div className="list">
                {paused.map((cost) => {
                  const since = pausedFrom(cost);
                  return (
                    <ListRow
                      key={cost.id}
                      title={cost.description}
                      subtitle={`${cost.category}${since ? ` · pausad sedan ${formatMonth(since)}` : ''}`}
                      amount={sek(monthlyAmount(cost))}
                      amountNote="/mån"
                      onClick={() => {
                        setDraft({ ...cost });
                        setIsNew(false);
                      }}
                    />
                  );
                })}
              </div>
            </>
          )}
        </Card>
      )}

      {draft && (
        <Sheet title={isNew ? 'Ny kostnad' : 'Ändra kostnad'} onClose={() => setDraft(null)}>
          <Field label="Beskrivning">
            <input
              autoFocus
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              placeholder="t.ex. Bilförsäkring"
            />
          </Field>
          <Field label="Kategori">
            <select
              value={draft.category}
              onChange={(e) => setDraft({ ...draft, category: e.target.value })}
            >
              {CATEGORIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </Field>
          <div className="field-pair">
            <Field label="Belopp per betalning">
              <AmountInput
                value={draft.amount || ''}
                onChange={(v) => setDraft({ ...draft, amount: v })}
              />
            </Field>
            <Field label="Hur ofta">
              <select
                value={draft.intervalMonths}
                onChange={(e) => setDraft({ ...draft, intervalMonths: Number(e.target.value) })}
              >
                {INTERVALS.map((i) => (
                  <option key={i.value} value={i.value}>
                    {i.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field
            label="Första betalning"
            hint={
              draft.intervalMonths === 1
                ? 'Dras varje månad.'
                : `Dras sedan var ${draft.intervalMonths}:e månad räknat från den här månaden.`
            }
          >
            <MonthInput
              value={draft.firstCharge}
              onChange={(v) => setDraft({ ...draft, firstCharge: v })}
            />
          </Field>
          <Field
            label="Betalas av"
            hint="Gemensamt drar pengarna från det gemensamma kontot. Väljer du en person dras kostnaden i stället från den personens överföring."
          >
            <PayerSelect
              members={budget.members}
              value={draft.payerId}
              onChange={(payerId) => setDraft({ ...draft, payerId })}
            />
          </Field>

          {draft.amount > 0 && draft.intervalMonths > 1 && (
            <Note>
              {sek(draft.amount)} var {draft.intervalMonths}:e månad blir{' '}
              <strong>{sek(monthlyAmount(draft))}/mån</strong> i budgeten. Uttagen sker i{' '}
              {upcomingCharges(draft, currentMonth(), 12)
                .map(formatMonthShort)
                .join(', ') || 'kommande år'}
              .
            </Note>
          )}

          {!isNew && (
            <div className="btn-row">
              {isCostPaused(draft, thisMonth) ? (
                <button className="btn btn-secondary" onClick={() => resume(draft)}>
                  Återuppta
                </button>
              ) : (
                <button className="btn btn-secondary" onClick={() => pause(draft)}>
                  Pausa
                </button>
              )}
              <button className="btn btn-danger" onClick={remove}>
                Ta bort
              </button>
            </div>
          )}

          <div className="btn-row">
            <button className="btn" onClick={save}>
              Spara
            </button>
          </div>
        </Sheet>
      )}
    </>
  );
}
