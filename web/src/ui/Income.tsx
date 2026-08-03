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
import { addMonths, currentMonth, formatMonth, formatMonthShort } from '../domain/month';
import { AmountInput, Card, Field, ListRow, MonthInput, Note, Sheet } from './components';

export function Income() {
  const { budget, me, isAdmin, update } = useBudget();
  const [editing, setEditing] = useState<Month | null>(null);
  /** null means "not confirmed", which is deliberately different from a zero. */
  const [drafts, setDrafts] = useState<Record<string, number | null>>({});

  const thisMonth = currentMonth();
  const members = activeMembers(budget);
  const history = incomeHistory(budget, thisMonth);
  const awaiting = membersAwaitingIncome(budget, thisMonth);

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

  function setBalance(amount: number, month: string) {
    update((b) => ({ ...b, accountBalance: { amount, month } }));
  }

  return (
    <>
      <Card title={`Denna månad · ${formatMonth(thisMonth)}`}>
        <div className="list">
          {members.map((member) => {
            const confirmed = hasConfirmedIncome(budget, member.id, thisMonth);
            return (
              <ListRow
                key={member.id}
                title={member.name}
                badge={confirmed ? undefined : 'Ej bekräftad'}
                subtitle={
                  confirmed
                    ? member.id === me.id
                      ? 'Bekräftad av dig'
                      : 'Bekräftad'
                    : `Räknar med normalt ${sek(member.baselineIncome)}`
                }
                amount={sek(incomeFor(budget, member.id, thisMonth))}
                onClick={canEditIncomeFor(me, member.id) ? () => openEditor(thisMonth) : undefined}
              />
            );
          })}
        </div>
        {isAdmin && awaiting.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <Note>
              Väntar på {awaiting.map((m) => m.name).join(', ')}. Som administratör kan du fylla i
              åt dem.
            </Note>
          </div>
        )}
      </Card>

      <Card title="Normal inkomst">
        <div style={{ marginBottom: 14 }}>
          <Note>
            Vad ni normalt får in. Används för framtida månader i prognosen och som utgångspunkt
            när ni bekräftar månadens inkomst.
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

      <Card title="Historik">
        <div className="scroll-x">
          <table className="table">
            <thead>
              <tr>
                <th>Månad</th>
                {members.map((m) => (
                  <th key={m.id}>{m.name}</th>
                ))}
                <th>Totalt</th>
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
            Grå siffror med ~ är uppskattningar som räknats fram från normal inkomst, inte
            bekräftade belopp. Tryck på en månad för att fylla i eller ändra.
          </Note>
        </div>
      </Card>

      <Card title="Gemensamt konto">
        <div style={{ marginBottom: 14 }}>
          <Note>Ange saldot som det faktiskt ser ut i dag. Prognosen räknar framåt därifrån.</Note>
        </div>
        <div className="field-pair">
          <Field label="Saldo">
            <AmountInput
              value={budget.accountBalance?.amount ?? ''}
              onChange={(v) => setBalance(v, budget.accountBalance?.month ?? thisMonth)}
              step={100}
            />
          </Field>
          <Field label="Gäller månad">
            <MonthInput
              value={budget.accountBalance?.month ?? thisMonth}
              onChange={(v) => setBalance(budget.accountBalance?.amount ?? 0, v)}
            />
          </Field>
        </div>
        {budget.accountBalance && (
          <span className="hint">
            Prognosen börjar i {formatMonth(budget.accountBalance.month)} och sträcker sig till{' '}
            {formatMonth(addMonths(budget.accountBalance.month, 23))}.
          </span>
        )}
      </Card>

      {editing && (
        <Sheet title={`Inkomst · ${formatMonth(editing)}`} onClose={() => setEditing(null)}>
          {members.map((member) => {
            const allowed = canEditIncomeFor(me, member.id);
            const value = drafts[member.id];
            return (
              <Field
                key={member.id}
                label={member.name + (allowed ? '' : ' (endast hen kan ändra)')}
                hint={
                  value === null
                    ? `Lämna tomt för att låta månaden stå kvar som uppskattning (${sek(member.baselineIncome)})`
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
                    Ta bort bekräftelsen
                  </button>
                )}
              </Field>
            );
          })}
          {members.some((m) => !canEditIncomeFor(me, m.id)) && (
            <Note>Du kan bara ändra din egen inkomst. Administratörer kan ändra allas.</Note>
          )}
          <div className="btn-row">
            <button className="btn btn-secondary" onClick={() => setEditing(null)}>
              Avbryt
            </button>
            <button className="btn" onClick={saveEditor}>
              Spara
            </button>
          </div>
        </Sheet>
      )}
    </>
  );
}
