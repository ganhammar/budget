import { useState } from 'react';
import { useBudget, newId } from '../store/store';
import type { OneOffCost } from '../domain/types';
import {
  isActiveIn,
  monthlyShare,
  monthsRemaining,
  remainingToRepay,
  repaymentMonths,
} from '../domain/engine';
import { sek } from '../domain/format';
import { addMonths, currentMonth, formatMonthShort } from '../domain/month';
import { AmountInput, Card, Empty, Field, ListRow, MonthInput, Note, PayerSelect, Sheet } from './components';

function blank(): OneOffCost {
  const now = currentMonth();
  return { id: newId(), description: '', total: 0, start: now, end: addMonths(now, 3) };
}

export function OneOffCosts() {
  const { budget, update } = useBudget();
  const [draft, setDraft] = useState<OneOffCost | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [showFinished, setShowFinished] = useState(false);

  const now = currentMonth();
  const ongoing = budget.oneOffCosts.filter((c) => isActiveIn(c, now) || c.start > now);
  const finished = budget.oneOffCosts.filter((c) => !ongoing.includes(c));
  const monthlyTotal = budget.oneOffCosts
    .filter((c) => isActiveIn(c, now))
    .reduce((sum, c) => sum + monthlyShare(c), 0);

  function save() {
    if (!draft || !draft.description.trim()) return;
    update((b) => ({
      ...b,
      oneOffCosts: isNew
        ? [...b.oneOffCosts, draft]
        : b.oneOffCosts.map((c) => (c.id === draft.id ? draft : c)),
    }));
    setDraft(null);
  }

  function remove() {
    if (!draft) return;
    update((b) => ({ ...b, oneOffCosts: b.oneOffCosts.filter((c) => c.id !== draft.id) }));
    setDraft(null);
  }

  const memberName = (id?: string) => budget.members.find((m) => m.id === id)?.name;

  const row = (cost: OneOffCost) => (
    <ListRow
      key={cost.id}
      title={cost.description}
      badge={memberName(cost.payerId)}
      subtitle={`${sek(cost.total)} · ${formatMonthShort(cost.start)}–${formatMonthShort(addMonths(cost.end, -1))} · ${monthsRemaining(cost, now)} mån kvar (${sek(remainingToRepay(cost, now))})`}
      amount={sek(monthlyShare(cost))}
      amountNote="/mån"
      onClick={() => {
        setDraft({ ...cost });
        setIsNew(false);
      }}
    />
  );

  return (
    <>
      <Card
        title={`Engångskostnader · ${sek(monthlyTotal)}/mån`}
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
        <div style={{ marginBottom: 12 }}>
          <Note>
            Hela beloppet lämnar det gemensamma kontot vid startmånaden och betalas tillbaka med
            månadsbeloppet fram till slutmånaden.
          </Note>
        </div>
        {ongoing.length === 0 && <Empty text="Inga pågående engångskostnader." />}
        <div className="list">{ongoing.map(row)}</div>
      </Card>

      {finished.length > 0 && (
        <Card
          title={`Avslutade · ${finished.length}`}
          action={
            <button
              className="btn btn-small btn-secondary"
              onClick={() => setShowFinished((v) => !v)}
            >
              {showFinished ? 'Dölj' : 'Visa'}
            </button>
          }
        >
          {showFinished && <div className="list">{finished.map(row)}</div>}
        </Card>
      )}

      {draft && (
        <Sheet
          title={isNew ? 'Ny engångskostnad' : 'Ändra engångskostnad'}
          onClose={() => setDraft(null)}
        >
          <Field label="Beskrivning">
            <input
              autoFocus
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              placeholder="t.ex. Tvättmaskin"
            />
          </Field>
          <Field label="Total kostnad">
            <AmountInput
              value={draft.total || ''}
              onChange={(v) => setDraft({ ...draft, total: v })}
            />
          </Field>
          <div className="field-pair">
            <Field label="Betalas ut" hint="Månaden pengarna lämnar kontot.">
              <MonthInput value={draft.start} onChange={(v) => setDraft({ ...draft, start: v })} />
            </Field>
            <Field label="Återbetalt till" hint="Exklusiv, sista avbetalningen är månaden före.">
              <MonthInput value={draft.end} onChange={(v) => setDraft({ ...draft, end: v })} />
            </Field>
          </div>
          <Field label="Betalas av">
            <PayerSelect
              members={budget.members}
              value={draft.payerId}
              onChange={(payerId) => setDraft({ ...draft, payerId })}
            />
          </Field>

          {draft.total > 0 && (
            <Note>
              {sek(draft.total)} fördelat på {repaymentMonths(draft)} månader blir{' '}
              <strong>{sek(monthlyShare(draft))}/mån</strong>.
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
