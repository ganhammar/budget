import { useMemo, useState } from 'react';
import { useBudget, newId } from '../store/store';
import { CATEGORIES, INTERVALS, type RecurringCost } from '../domain/types';
import { monthlyAmount, upcomingCharges } from '../domain/engine';
import { sek } from '../domain/format';
import { currentMonth, formatMonthShort } from '../domain/month';
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

  const groups = useMemo(() => {
    const map = new Map<string, RecurringCost[]>();
    for (const cost of budget.recurringCosts) {
      map.set(cost.category, [...(map.get(cost.category) ?? []), cost]);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0], 'sv'));
  }, [budget.recurringCosts]);

  const total = budget.recurringCosts.reduce((sum, c) => sum + monthlyAmount(c), 0);
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
        {budget.recurringCosts.length === 0 && <Empty text="Inga kostnader inlagda än." />}
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

          <div className="btn-row">
            {!isNew && (
              <button className="btn btn-danger" onClick={remove}>
                Ta bort
              </button>
            )}
            <button className="btn" onClick={save}>
              Spara
            </button>
          </div>
        </Sheet>
      )}
    </>
  );
}
