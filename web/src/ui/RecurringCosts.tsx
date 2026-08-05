import { useMemo, useState } from 'react';
import { useBudget, newId } from '../store/store';
import {
  categoriesFor,
  DEFAULT_CATEGORIES,
  INTERVALS,
  WEEK_INTERVALS,
  type RecurringCost,
} from '../domain/types';
import {
  intervalLabel,
  isCostPaused,
  monthlyAmount,
  pausedFrom,
  upcomingCharges,
} from '../domain/engine';
import { sek } from '../domain/format';
import { currentMonth, formatMonth, formatMonthShort } from '../domain/month';
import { AmountInput, Card, Empty, Field, ListRow, MonthInput, Note, PayerSelect, Sheet } from './components';
import { monthIntervalLabel, useText, weekIntervalLabel } from '../i18n';

/** Sentinel option value; a real category can never be the empty string. */
const NEW_CATEGORY = '';

function blank(first: string): RecurringCost {
  return {
    id: newId(),
    category: first,
    description: '',
    amount: 0,
    intervalMonths: 1,
    firstCharge: currentMonth(),
  };
}

export function RecurringCosts() {
  const { budget, update } = useBudget();
  const t = useText();
  const [draft, setDraft] = useState<RecurringCost | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [showPaused, setShowPaused] = useState(false);
  // Non-null while the category field is a text box rather than the dropdown.
  const [newCategory, setNewCategory] = useState<string | null>(null);

  const categories = categoriesFor(budget);

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

    const category = (newCategory ?? draft.category).trim();
    if (!category) return;
    const cost = { ...draft, category };

    // A category the household has not seen before is added to its list in the same
    // write, so it is offered next time even before any cost is saved against it.
    const known = categories.some((c) => c.toLowerCase() === category.toLowerCase());

    update((b) => ({
      ...b,
      household: known
        ? b.household
        : { ...b.household, categories: [...(b.household.categories ?? DEFAULT_CATEGORIES), category] },
      recurringCosts: isNew
        ? [...b.recurringCosts, cost]
        : b.recurringCosts.map((c) => (c.id === cost.id ? cost : c)),
    }));
    closeSheet();
  }

  function closeSheet() {
    setDraft(null);
    setNewCategory(null);
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
    closeSheet();
  }

  /** Opens a fresh period, leaving the gap in place. */
  function resume(cost: RecurringCost) {
    const periods = [...(cost.periods ?? []), { from: thisMonth }];
    update((b) => ({
      ...b,
      recurringCosts: b.recurringCosts.map((c) => (c.id === cost.id ? { ...c, periods } : c)),
    }));
    closeSheet();
  }

  function remove() {
    if (!draft) return;
    update((b) => ({ ...b, recurringCosts: b.recurringCosts.filter((c) => c.id !== draft.id) }));
    closeSheet();
  }

  return (
    <>
      <Card
        title={`${t.sharedCosts} · ${sek(total)}${t.perMonth}`}
        action={
          <button
            className="btn btn-small"
            onClick={() => {
              setNewCategory(null);
              setDraft(blank(categories[0] ?? ''));
              setIsNew(true);
            }}
          >
            {t.add}
          </button>
        }
      >
        {live.length === 0 && <Empty text={t.noActiveCosts} />}
        {groups.map(([category, costs]) => (
          <div key={category} style={{ marginBottom: 14 }}>
            <div className="group-label">
              {category} · {sek(costs.reduce((sum, c) => sum + monthlyAmount(c), 0))}
              {t.perMonth}
            </div>
            <div className="list">
              {costs.map((cost) => {
                const next = upcomingCharges(cost, currentMonth(), 12)[0];
                return (
                  <ListRow
                    key={cost.id}
                    title={cost.description}
                    badge={memberName(cost.payerId)}
                    subtitle={
                      cost.intervalWeeks || cost.intervalMonths !== 1
                        ? `${sek(cost.amount)} · ${intervalLabel(cost, t)}${next ? ` · ${t.nextCharge(formatMonthShort(next))}` : ''}`
                        : t.everyMonth
                    }
                    amount={sek(monthlyAmount(cost))}
                    amountNote={t.perMonth}
                    onClick={() => {
                      setNewCategory(null);
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
          title={`${t.pausedTitle} · ${paused.length}`}
          action={
            <button
              className="btn btn-small btn-secondary"
              onClick={() => setShowPaused((v) => !v)}
            >
              {showPaused ? t.hide : t.show}
            </button>
          }
        >
          {showPaused && (
            <>
              <Note>{t.pausedNote}</Note>
              <div className="list">
                {paused.map((cost) => {
                  const since = pausedFrom(cost);
                  return (
                    <ListRow
                      key={cost.id}
                      title={cost.description}
                      subtitle={`${cost.category}${since ? ` · ${t.pausedSince(formatMonth(since))}` : ''}`}
                      amount={sek(monthlyAmount(cost))}
                      amountNote={t.perMonth}
                      onClick={() => {
                        setNewCategory(null);
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
        <Sheet title={isNew ? t.newCost : t.editCost} onClose={closeSheet}>
          <Field label={t.description}>
            <input
              autoFocus
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              placeholder={t.costPlaceholder}
            />
          </Field>
          <Field label={t.category}>
            {newCategory === null ? (
              <select
                value={draft.category}
                onChange={(e) =>
                  e.target.value === NEW_CATEGORY
                    ? setNewCategory('')
                    : setDraft({ ...draft, category: e.target.value })
                }
              >
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
                <option value={NEW_CATEGORY}>{t.newCategory}</option>
              </select>
            ) : (
              <>
                <input
                  autoFocus
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value)}
                  placeholder={t.newCategoryPlaceholder}
                />
                <button
                  className="btn btn-small btn-secondary"
                  style={{ alignSelf: 'flex-start', marginTop: 8 }}
                  onClick={() => setNewCategory(null)}
                >
                  {t.pickExistingCategory}
                </button>
              </>
            )}
          </Field>
          <div className="field-pair">
            <Field label={t.amountPerCharge}>
              <AmountInput
                value={draft.amount || ''}
                onChange={(v) => setDraft({ ...draft, amount: v })}
              />
            </Field>
            <Field label={t.howOften}>
              <select
                value={draft.intervalWeeks ? `w${draft.intervalWeeks}` : `m${draft.intervalMonths}`}
                onChange={(e) => {
                  const [unit, n] = [e.target.value[0], Number(e.target.value.slice(1))];
                  setDraft(
                    unit === 'w'
                      ? {
                          ...draft,
                          intervalWeeks: n,
                          // A weekly cadence counts from a day, not a month.
                          firstChargeDate: draft.firstChargeDate ?? `${draft.firstCharge}-01`,
                        }
                      : { ...draft, intervalWeeks: undefined, intervalMonths: n },
                  );
                }}
              >
                <optgroup label={t.groupMonths}>
                  {INTERVALS.map((months) => (
                    <option key={months} value={`m${months}`}>
                      {monthIntervalLabel(t, months)}
                    </option>
                  ))}
                </optgroup>
                <optgroup label={t.groupWeeks}>
                  {WEEK_INTERVALS.map((weeks) => (
                    <option key={weeks} value={`w${weeks}`}>
                      {weekIntervalLabel(t, weeks)}
                    </option>
                  ))}
                </optgroup>
              </select>
            </Field>
          </div>
          {draft.intervalWeeks ? (
            <Field
              label={t.firstCharge}
              hint={t.chargedFromDate(intervalLabel(draft, t))}
            >
              <input
                type="date"
                value={draft.firstChargeDate ?? ''}
                onChange={(e) => setDraft({ ...draft, firstChargeDate: e.target.value })}
              />
            </Field>
          ) : (
            <Field
              label={t.firstCharge}
              hint={
                draft.intervalMonths === 1
                  ? t.chargedMonthly
                  : t.chargedFromMonth(intervalLabel(draft, t))
              }
            >
              <MonthInput
                value={draft.firstCharge}
                onChange={(v) => setDraft({ ...draft, firstCharge: v })}
              />
            </Field>
          )}
          <Field
            label={t.paidBy}
            hint={t.paidByHint}
          >
            <PayerSelect
              members={budget.members}
              value={draft.payerId}
              onChange={(payerId) => setDraft({ ...draft, payerId })}
            />
          </Field>

          {draft.amount > 0 && (draft.intervalWeeks || draft.intervalMonths > 1) && (
            <Note>
              {t.budgetedPrefix(sek(draft.amount), intervalLabel(draft, t))}{' '}
              <strong>
                {sek(monthlyAmount(draft))}
                {t.perMonth}
              </strong>
              {t.budgetedSuffix} {t.chargesOccurIn}{' '}
              {upcomingCharges(draft, currentMonth(), 12)
                .map(formatMonthShort)
                .join(', ') || t.comingYears}
              .
            </Note>
          )}

          {!isNew && (
            <div className="btn-row">
              {isCostPaused(draft, thisMonth) ? (
                <button className="btn btn-secondary" onClick={() => resume(draft)}>
                  {t.resume}
                </button>
              ) : (
                <button className="btn btn-secondary" onClick={() => pause(draft)}>
                  {t.pause}
                </button>
              )}
              <button className="btn btn-danger" onClick={remove}>
                {t.remove}
              </button>
            </div>
          )}

          <div className="btn-row">
            <button className="btn" onClick={save}>
              {t.save}
            </button>
          </div>
        </Sheet>
      )}
    </>
  );
}
