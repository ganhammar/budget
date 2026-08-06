import { useState } from 'react';
import { useBudget, newId } from '../store/store';
import { activeMembers, type Month, type Saving, type SavingTerms } from '../domain/types';
import {
  canEditIncomeFor,
  hasConfirmedIncome,
  incomeHistory,
  membersAwaitingIncome,
} from '../domain/income';
import { incomeFor, isCostPaused, pausedFrom, savingAmountAt } from '../domain/engine';
import { sek } from '../domain/format';
import { addMonths, currentMonth, formatMonth, formatMonthShort } from '../domain/month';
import {
  ActionSheet,
  AmountInput,
  Card,
  Empty,
  Field,
  ListRow,
  MonthInput,
  Note,
  Sheet,
} from './components';
import { ConfirmIncome } from './ConfirmIncome';
import { useText } from '../i18n';

export function Income() {
  const { budget, me, isAdmin, update } = useBudget();
  const t = useText();
  const [editing, setEditing] = useState<Month | null>(null);
  const [savingDraft, setSavingDraft] = useState<Saving | null>(null);
  const [savingIsNew, setSavingIsNew] = useState(false);
  const [savingActions, setSavingActions] = useState<Saving | null>(null);
  const [savingTermsFor, setSavingTermsFor] = useState<Saving | null>(null);
  const [savingTermsDraft, setSavingTermsDraft] = useState<SavingTerms | null>(null);
  /** null means "not confirmed", which is deliberately different from a zero. */
  const [drafts, setDrafts] = useState<Record<string, number | null>>({});

  const thisMonth = currentMonth();
  const members = activeMembers(budget);
  const history = incomeHistory(budget, thisMonth);
  const awaiting = membersAwaitingIncome(budget, thisMonth);
  const myIncomeConfirmed = hasConfirmedIncome(budget, me.id, thisMonth);

  function setBaseline(memberId: string, amount: number) {
    update((b) => ({
      ...b,
      members: b.members.map((m) => (m.id === memberId ? { ...m, baselineIncome: amount } : m)),
    }));
  }

  function openEditor(month: Month) {
    const initial: Record<string, number | null> = {};
    for (const member of members) {
      const entry = budget.income.find((i) => i.memberId === member.id && i.month === month);
      initial[member.id] = entry ? entry.amount : null;
    }
    setDrafts(initial);
    setEditing(month);
  }

  /**
   * Only members with a value are written. Leaving someone blank keeps their
   * month unconfirmed rather than silently recording the baseline as fact.
   */
  function saveEditor() {
    if (!editing) return;
    const editable = members.filter((m) => canEditIncomeFor(me, m.id));
    update((b) => ({
      ...b,
      income: [
        ...b.income.filter(
          (i) => i.month !== editing || !editable.some((m) => m.id === i.memberId),
        ),
        ...editable
          .filter((m) => drafts[m.id] !== null && drafts[m.id] !== undefined)
          .map((m) => ({
            memberId: m.id,
            month: editing,
            amount: drafts[m.id] as number,
            enteredById: m.id === me.id ? undefined : me.id,
          })),
      ],
    }));
    setEditing(null);
  }

  /* ---------- Savings ---------- */

  function updateSavings(fn: (savings: Saving[]) => Saving[]) {
    update((b) => ({ ...b, savings: fn(b.savings) }));
  }

  function saveSaving() {
    if (!savingDraft || !savingDraft.name.trim()) return;
    const saving = { ...savingDraft, name: savingDraft.name.trim() };
    updateSavings((savings) =>
      savingIsNew ? [...savings, saving] : savings.map((s) => (s.id === saving.id ? saving : s)),
    );
    setSavingDraft(null);
  }

  function removeSaving(saving: Saving) {
    updateSavings((savings) => savings.filter((s) => s.id !== saving.id));
    setSavingDraft(null);
    setSavingActions(null);
  }

  /** Closes the open stretch at this month, exactly as pausing a cost does. */
  function pauseSaving(saving: Saving) {
    const periods = saving.periods && saving.periods.length > 0 ? [...saving.periods] : [{}];
    const last = periods[periods.length - 1];
    if (last.to) return;
    periods[periods.length - 1] = { ...last, to: thisMonth };
    updateSavings((savings) => savings.map((s) => (s.id === saving.id ? { ...s, periods } : s)));
    setSavingActions(null);
  }

  function resumeSaving(saving: Saving) {
    const periods = [...(saving.periods ?? []), { from: thisMonth }];
    updateSavings((savings) => savings.map((s) => (s.id === saving.id ? { ...s, periods } : s)));
    setSavingActions(null);
  }

  function openSavingTerms(saving: Saving) {
    setSavingTermsFor(saving);
    setSavingTermsDraft({ from: thisMonth, amount: savingAmountAt(saving, thisMonth) });
    setSavingActions(null);
  }

  function saveSavingTerms() {
    if (!savingTermsFor || !savingTermsDraft) return;
    const terms = [
      ...(savingTermsFor.terms ?? []).filter((e) => e.from !== savingTermsDraft.from),
      savingTermsDraft,
    ].sort((a, b) => a.from.localeCompare(b.from));
    updateSavings((savings) =>
      savings.map((s) => (s.id === savingTermsFor.id ? { ...s, terms } : s)),
    );
    setSavingTermsFor(null);
    setSavingTermsDraft(null);
  }

  function removeSavingTerms(from: string) {
    if (!savingTermsFor) return;
    const terms = (savingTermsFor.terms ?? []).filter((e) => e.from !== from);
    updateSavings((savings) =>
      savings.map((s) => (s.id === savingTermsFor.id ? { ...s, terms } : s)),
    );
    setSavingTermsFor({ ...savingTermsFor, terms });
  }

  function setBalance(amount: number, month: string) {
    update((b) => ({ ...b, accountBalance: { amount, month } }));
  }

  return (
    <>
      <Card
        title={`${t.thisMonth} · ${formatMonth(thisMonth)}`}
        action={
          myIncomeConfirmed ? (
            <button className="btn btn-small btn-secondary" onClick={() => openEditor(thisMonth)}>
              {t.edit}
            </button>
          ) : undefined
        }
      >
        {/* The whole point of the tab: answer it before anything else is shown. */}
        {!myIncomeConfirmed && (
          <div className="ask">
            <p className="ask-text">{t.askIncome(formatMonth(thisMonth))}</p>
            <ConfirmIncome month={thisMonth} />
          </div>
        )}

        <div className="list">
          {members.map((member) => {
            const confirmed = hasConfirmedIncome(budget, member.id, thisMonth);
            return (
              <ListRow
                key={member.id}
                title={member.name}
                badge={confirmed ? undefined : t.notConfirmed}
                subtitle={
                  confirmed
                    ? member.id === me.id
                      ? t.confirmedByYou
                      : t.confirmed
                    : t.assumingNormal(sek(member.baselineIncome))
                }
                amount={sek(incomeFor(budget, member.id, thisMonth))}
                // An unconfirmed figure is the baseline carried forward, not a
                // fact. Same grey as the estimates in the history table.
                estimate={!confirmed}
                onClick={canEditIncomeFor(me, member.id) ? () => openEditor(thisMonth) : undefined}
              />
            );
          })}
        </div>
        {isAdmin && awaiting.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <Note>
              {t.waitingFor(awaiting.map((m) => m.name).join(', '))}
            </Note>
          </div>
        )}
      </Card>

      <Card title={t.normalIncome}>
        <div style={{ marginBottom: 14 }}>
          <Note>
            {t.normalIncomeNote}
          </Note>
        </div>
        {members.map((member) => (
          <Field key={member.id} label={member.name}>
            <AmountInput
              value={member.baselineIncome || ''}
              onChange={(v) => setBaseline(member.id, v)}
              step={100}
            />
          </Field>
        ))}
      </Card>

      <Card
        title={t.savings}
        action={
          <button
            className="btn btn-small"
            onClick={() => {
              setSavingDraft({ id: newId(), memberId: me.id, name: '', amount: 0 });
              setSavingIsNew(true);
            }}
          >
            {t.add}
          </button>
        }
      >
        <div style={{ marginBottom: 12 }}>
          <Note>{t.savingsNote}</Note>
        </div>
        {budget.savings.length === 0 && <Empty text={t.noSavings} />}
        <div className="list">
          {budget.savings.map((saving) => {
            const paused = isCostPaused(saving, thisMonth);
            const since = pausedFrom(saving);
            return (
              <ListRow
                key={saving.id}
                title={saving.name}
                badge={paused ? t.pause : undefined}
                subtitle={paused && since ? t.pausedSince(formatMonth(since)) : undefined}
                amount={sek(savingAmountAt(saving, thisMonth))}
                amountNote={t.perMonth}
                estimate={paused}
                onClick={() => setSavingActions(saving)}
              />
            );
          })}
        </div>
      </Card>

      <Card title={t.history}>
        <div className="scroll-x">
          <table className="table">
            <thead>
              <tr>
                <th>{t.monthLabel}</th>
                {members.map((m) => (
                  <th key={m.id}>{m.name}</th>
                ))}
                <th>{t.total}</th>
              </tr>
            </thead>
            <tbody>
              {history.map((row) => (
                <tr
                  key={row.month}
                  onClick={() => openEditor(row.month)}
                  style={{ cursor: 'pointer' }}
                >
                  <td>
                    {formatMonthShort(row.month)}
                    {!row.fullyConfirmed && <span className="estimate"> ~</span>}
                  </td>
                  {row.entries.map((entry) => (
                    <td key={entry.memberId} className={entry.confirmed ? '' : 'estimate'}>
                      {sek(entry.amount)}
                    </td>
                  ))}
                  <td className={row.fullyConfirmed ? '' : 'estimate'}>{sek(row.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ marginTop: 12 }}>
          <Note>
            {t.historyNote}
          </Note>
        </div>
      </Card>

      <Card title={t.jointAccount}>
        <div style={{ marginBottom: 14 }}>
          <Note>{t.balanceNote}</Note>
        </div>
        <div className="field-pair">
          <Field label={t.balanceField}>
            <AmountInput
              value={budget.accountBalance?.amount ?? ''}
              onChange={(v) => setBalance(v, budget.accountBalance?.month ?? thisMonth)}
              step={100}
            />
          </Field>
          <Field label={t.appliesToMonth}>
            <MonthInput
              value={budget.accountBalance?.month ?? thisMonth}
              onChange={(v) => setBalance(budget.accountBalance?.amount ?? 0, v)}
            />
          </Field>
        </div>
        {budget.accountBalance && (
          <span className="hint">
            {t.forecastRange(
              formatMonth(budget.accountBalance.month),
              formatMonth(addMonths(budget.accountBalance.month, 23)),
            )}
          </span>
        )}
      </Card>

      {editing && (
        <Sheet title={`${t.income} · ${formatMonth(editing)}`} onClose={() => setEditing(null)}>
          {members.map((member) => {
            const allowed = canEditIncomeFor(me, member.id);
            const value = drafts[member.id];
            return (
              <Field
                key={member.id}
                label={member.name + (allowed ? '' : ` ${t.onlyTheyCanEdit}`)}
                hint={
                  value === null
                    ? t.leaveBlankHint(sek(member.baselineIncome))
                    : undefined
                }
              >
                {allowed ? (
                  <AmountInput
                    value={value ?? ''}
                    placeholder={String(member.baselineIncome || 0)}
                    onChange={(v) => setDrafts({ ...drafts, [member.id]: v })}
                    step={100}
                  />
                ) : (
                  <input value={sek(incomeFor(budget, member.id, editing))} disabled />
                )}
                {allowed && value !== null && (
                  <button
                    className="btn btn-small btn-secondary"
                    style={{ alignSelf: 'flex-start', marginTop: 4 }}
                    onClick={() => setDrafts({ ...drafts, [member.id]: null })}
                  >
                    {t.removeConfirmation}
                  </button>
                )}
              </Field>
            );
          })}
          {members.some((m) => !canEditIncomeFor(me, m.id)) && (
            <Note>{t.ownIncomeOnly}</Note>
          )}
          <div className="btn-row">
            <button className="btn btn-secondary" onClick={() => setEditing(null)}>
              {t.cancel}
            </button>
            <button className="btn" onClick={saveEditor}>
              {t.save}
            </button>
          </div>
        </Sheet>
      )}

      {savingActions && (
        <ActionSheet
          title={savingActions.name}
          onClose={() => setSavingActions(null)}
          actions={[
            {
              label: t.edit,
              onSelect: () => {
                setSavingDraft({ ...savingActions });
                setSavingIsNew(false);
                setSavingActions(null);
              },
            },
            { label: t.changeSaving, onSelect: () => openSavingTerms(savingActions) },
            isCostPaused(savingActions, thisMonth)
              ? { label: t.resume, onSelect: () => resumeSaving(savingActions) }
              : { label: t.pause, onSelect: () => pauseSaving(savingActions) },
            {
              label: t.remove,
              danger: true,
              onSelect: () => {
                if (confirm(t.confirmRemove(savingActions.name))) removeSaving(savingActions);
              },
            },
          ]}
        />
      )}

      {savingDraft && (
        <Sheet
          title={savingIsNew ? t.newSaving : t.editSaving}
          onClose={() => setSavingDraft(null)}
        >
          <Field label={t.description}>
            <input
              autoFocus
              value={savingDraft.name}
              onChange={(e) => setSavingDraft({ ...savingDraft, name: e.target.value })}
              placeholder={t.savingPlaceholder}
            />
          </Field>
          {savingIsNew ? (
            <Field label={t.amountPerMonthLabel}>
              <AmountInput
                value={savingDraft.amount || ''}
                onChange={(amount) => setSavingDraft({ ...savingDraft, amount })}
                step={100}
              />
            </Field>
          ) : (
            <div className="field">
              <label>{t.currentSaving}</label>
              <div className="terms-current">
                <span>{sek(savingAmountAt(savingDraft, thisMonth))}</span>
                <span>{t.perMonth}</span>
              </div>
              <span className="hint">{t.changeSavingHint}</span>
            </div>
          )}
          <div className="btn-row">
            <button className="btn btn-secondary" onClick={() => setSavingDraft(null)}>
              {t.cancel}
            </button>
            <button className="btn" onClick={saveSaving}>
              {t.save}
            </button>
          </div>
        </Sheet>
      )}

      {savingTermsFor && savingTermsDraft && (
        <Sheet title={t.changeSaving} onClose={() => setSavingTermsFor(null)}>
          <Field label={t.appliesFrom} hint={t.appliesFromHintSaving}>
            <MonthInput
              value={savingTermsDraft.from}
              onChange={(from) => setSavingTermsDraft({ ...savingTermsDraft, from })}
            />
          </Field>
          <Field label={t.amountPerMonthLabel}>
            <AmountInput
              value={savingTermsDraft.amount || ''}
              onChange={(amount) => setSavingTermsDraft({ ...savingTermsDraft, amount })}
              step={100}
            />
          </Field>

          {(savingTermsFor.terms ?? []).length > 0 && (
            <div className="field">
              <label>{t.termsHistory}</label>
              <div className="list">
                {[...(savingTermsFor.terms ?? [])]
                  .sort((a, b) => b.from.localeCompare(a.from))
                  .map((entry) => (
                    <ListRow
                      key={entry.from}
                      title={formatMonth(entry.from)}
                      amount={sek(entry.amount)}
                      onClick={() => removeSavingTerms(entry.from)}
                    />
                  ))}
              </div>
              <span className="hint">{t.termsHistoryHint}</span>
            </div>
          )}

          <div className="btn-row">
            <button className="btn btn-secondary" onClick={() => setSavingTermsFor(null)}>
              {t.cancel}
            </button>
            <button className="btn" onClick={saveSavingTerms}>
              {t.save}
            </button>
          </div>
        </Sheet>
      )}
    </>
  );
}
