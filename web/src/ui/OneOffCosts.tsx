import { useState } from 'react';

/** How much of the buffer a single absorbed cost may take. */
const MOST_OF_BUFFER = 0.8;
import { useBudget, newId } from '../store/store';
import type { OneOffCost } from '../domain/types';
import {
  bufferGoal,
  estimatedBalance,
  forecast,
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
  // Nothing absorbed is ever "active", because nobody is repaying it. It still
  // belongs to the month it landed in, so it sits with the current ones until that
  // month has passed and then joins the history like any other.
  const ongoing = budget.oneOffCosts.filter(
    (c) => isActiveIn(c, now) || c.start > now || (c.fromBuffer && c.start === now),
  );
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

  // What the account is expected to hold in the month the cost lands.
  const points = forecast(budget, 24);
  const available =
    (draft && points.find((p) => p.month === draft.start)?.opening) ??
    estimatedBalance(budget, currentMonth()) ??
    0;
  // A fifth of the buffer stays standing. Absorbing a cost that empties it leaves
  // the household with no buffer, which is the thing the buffer was for.
  const fits = draft ? draft.total > 0 && draft.total <= available * MOST_OF_BUFFER : false;

  const row = (cost: OneOffCost) => (
    <ListRow
      key={cost.id}
      title={cost.description}
      badge={cost.fromBuffer ? t.fromBufferBadge : memberName(cost.payerId)}
      subtitle={
        cost.fromBuffer
          ? `${sek(cost.total)} · ${formatMonthShort(cost.start)} · ${t.fromBufferRow}`
          : `${sek(cost.total)} · ${formatMonthShort(cost.start)}–${formatMonthShort(addMonths(cost.end, -1))} · ${t.monthsLeft(monthsRemaining(cost, now), sek(remainingToRepay(cost, now)))}`
      }
      amount={cost.fromBuffer ? sek(cost.total) : sek(monthlyShare(cost))}
      amountNote={cost.fromBuffer ? undefined : t.perMonth}
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
          <Note>{budget.oneOffCosts.length === 0 ? t.guideOneOff : t.oneOffNote}</Note>
        </div>
        {ongoing.length === 0 && budget.oneOffCosts.length > 0 && (
          <Empty text={t.noOngoingOneOffs} />
        )}
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
          {/* Always here, so it does not appear from nowhere once an amount is
              typed. The option inside it is what waits for the amount. */}
          {bufferGoal(budget, currentMonth()) > 0 && (
            <Field
              label={t.repayment}
              hint={draft.total > 0 && !fits ? t.fromBufferTooBig : undefined}
            >
              <select
                value={draft.fromBuffer ? 'buffer' : 'repay'}
                onChange={(e) => setDraft({ ...draft, fromBuffer: e.target.value === 'buffer' })}
              >
                <option value="repay">{t.repayOverTime}</option>
                <option value="buffer" disabled={!fits}>
                  {t.takeFromBuffer}
                </option>
              </select>
            </Field>
          )}

          {draft.fromBuffer && (
            <div style={{ marginBottom: 14 }}>
              <Note>{t.fromBufferWarning(sek(Math.max(0, available - draft.total)))}</Note>
            </div>
          )}

          <div className="field-pair">
            <Field label={t.paidOut} hint={t.paidOutHint}>
              <MonthInput value={draft.start} onChange={(v) => setDraft({ ...draft, start: v })} />
            </Field>
            {!draft.fromBuffer && (
              <Field label={t.repaidBy} hint={t.repaidByHint}>
                <MonthInput value={draft.end} onChange={(v) => setDraft({ ...draft, end: v })} />
              </Field>
            )}
          </div>

          <Field label={t.paidBy}>
            <PayerSelect
              members={budget.members}
              value={draft.payerId}
              onChange={(payerId) => setDraft({ ...draft, payerId })}
            />
          </Field>

          {draft.total > 0 && !draft.fromBuffer && (
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
