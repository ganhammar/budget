import { useState } from 'react';
import { useBudget } from '../store/store';
import { activeMembers, type Month } from '../domain/types';
import {
  canEditIncomeFor,
  hasConfirmedIncome,
  incomeHistory,
  membersAwaitingIncome,
} from '../domain/income';
import { incomeFor } from '../domain/engine';
import { sek } from '../domain/format';
import { currentMonth, formatMonth, formatMonthShort } from '../domain/month';
import { AmountInput, Card, Field, ListRow, Note, Sheet } from './components';
import { ConfirmIncome } from './ConfirmIncome';
import { useText } from '../i18n';

export function Income() {
  const { budget, me, isAdmin, update } = useBudget();
  const t = useText();
  const [editing, setEditing] = useState<Month | null>(null);
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

    </>
  );
}
