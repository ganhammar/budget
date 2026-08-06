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
import {
  ActionSheet,
  AmountInput,
  Card,
  Empty,
  Field,
  ListRow,
  MonthInput,
  Note,
  PayerSelect,
  Sheet,
} from './components';
import { useText } from '../i18n';

function blank(): OneOffCost {
  const now = currentMonth();
  return { id: newId(), description: '', total: 0, start: now, end: addMonths(now, 3) };
}

export function OneOffCosts() {
  const { budget, update } = useBudget();
  const t = useText();
  const [draft, setDraft] = useState<OneOffCost | null>(null);
  /** The cost whose action menu is open. */
  const [actionsFor, setActionsFor] = useState<OneOffCost | null>(null);
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

  function remove(cost: OneOffCost) {
    update((b) => ({ ...b, oneOffCosts: b.oneOffCosts.filter((c) => c.id !== cost.id) }));
    setDraft(null);
    setActionsFor(null);
  }

  const memberName = (id?: string) => budget.members.find((m) => m.id === id)?.name;

  const row = (cost: OneOffCost) => (
    <ListRow
      key={cost.id}
      title={cost.description}
      badge={memberName(cost.payerId)}
      subtitle={`${sek(cost.total)} · ${formatMonthShort(cost.start)}–${formatMonthShort(addMonths(cost.end, -1))} · ${t.monthsLeft(monthsRemaining(cost, now), sek(remainingToRepay(cost, now)))}`}
      amount={sek(monthlyShare(cost))}
      amountNote={t.perMonth}
      onClick={() => setActionsFor(cost)}
    />
  );

  return (
    <>
      <Card
        title={`${t.oneOffCosts} · ${sek(monthlyTotal)}${t.perMonth}`}
        action={
          <button
            className="btn btn-small"
            onClick={() => {
              setDraft(blank());
              setIsNew(true);
            }}
          >
            {t.add}
          </button>
        }
      >
        <div style={{ marginBottom: 12 }}>
          <Note>
            {t.oneOffNote}
          </Note>
        </div>
        {ongoing.length === 0 && <Empty text={t.noOngoingOneOffs} />}
        <div className="list">{ongoing.map(row)}</div>
      </Card>

      {finished.length > 0 && (
        <Card
          title={`${t.finished} · ${finished.length}`}
          action={
            <button
              className="btn btn-small btn-secondary"
              onClick={() => setShowFinished((v) => !v)}
            >
              {showFinished ? t.hide : t.show}
            </button>
          }
        >
          {showFinished && <div className="list">{finished.map(row)}</div>}
        </Card>
      )}

      {draft && (
        <Sheet
          title={isNew ? t.newOneOff : t.editOneOff}
          onClose={() => setDraft(null)}
        >
          <Field label={t.description}>
            <input
              autoFocus
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              placeholder={t.oneOffPlaceholder}
            />
          </Field>
          <Field label={t.totalCost}>
            <AmountInput
              value={draft.total || ''}
              onChange={(v) => setDraft({ ...draft, total: v })}
            />
          </Field>
          <div className="field-pair">
            <Field label={t.paidOut} hint={t.paidOutHint}>
              <MonthInput value={draft.start} onChange={(v) => setDraft({ ...draft, start: v })} />
            </Field>
            <Field label={t.repaidBy} hint={t.repaidByHint}>
              <MonthInput value={draft.end} onChange={(v) => setDraft({ ...draft, end: v })} />
            </Field>
          </div>
          <Field label={t.paidBy}>
            <PayerSelect
              members={budget.members}
              value={draft.payerId}
              onChange={(payerId) => setDraft({ ...draft, payerId })}
            />
          </Field>

          {draft.total > 0 && (
            <Note>
              {t.spreadPrefix(sek(draft.total), repaymentMonths(draft))}{' '}
              <strong>
                {sek(monthlyShare(draft))}
                {t.perMonth}
              </strong>
              .
            </Note>
          )}

          <div className="btn-row">
            <button className="btn btn-secondary" onClick={() => setDraft(null)}>
              {t.cancel}
            </button>
            <button className="btn" onClick={save}>
              {t.save}
            </button>
          </div>
        </Sheet>
      )}

      {actionsFor && (
        <ActionSheet
          title={actionsFor.description}
          onClose={() => setActionsFor(null)}
          actions={[
            {
              label: t.edit,
              onSelect: () => {
                setDraft({ ...actionsFor });
                setIsNew(false);
                setActionsFor(null);
              },
            },
            {
              label: t.remove,
              danger: true,
              onSelect: () => {
                if (confirm(t.confirmRemove(actionsFor.description))) remove(actionsFor);
              },
            },
          ]}
        />
      )}
    </>
  );
}
