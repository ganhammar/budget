import { useState } from 'react';
import { useStore, useBudget, newId } from '../store/store';
import type { Member, Role } from '../domain/types';
import { sek } from '../domain/format';
import { Card, Field, ListRow, Note, Sheet } from './components';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function Household() {
  const { budget, me, isAdmin, update } = useBudget();
  const { signInAs, reset } = useStore();
  const [inviting, setInviting] = useState(false);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<Member | null>(null);

  function invite() {
    const cleaned = email.trim().toLowerCase();
    if (!EMAIL.test(cleaned)) {
      setError('Ange en giltig e-postadress.');
      return;
    }
    if (budget.members.some((m) => m.email.toLowerCase() === cleaned)) {
      setError('Den adressen finns redan i hushållet.');
      return;
    }
    update((b) => ({
      ...b,
      members: [
        ...b.members,
        {
          id: newId(),
          name: name.trim() || cleaned.split('@')[0],
          email: cleaned,
          role: 'member',
          status: 'invited',
          baselineIncome: 0,
        },
      ],
    }));
    setEmail('');
    setName('');
    setError('');
    setInviting(false);
  }

  function changeRole(memberId: string, role: Role) {
    update((b) => ({
      ...b,
      members: b.members.map((m) => (m.id === memberId ? { ...m, role } : m)),
    }));
    setSelected(null);
  }

  function removeMember(memberId: string) {
    update((b) => ({
      ...b,
      members: b.members.filter((m) => m.id !== memberId),
      recurringCosts: b.recurringCosts.map((c) =>
        c.payerId === memberId ? { ...c, payerId: undefined } : c,
      ),
      oneOffCosts: b.oneOffCosts.map((c) =>
        c.payerId === memberId ? { ...c, payerId: undefined } : c,
      ),
      loans: b.loans.map((l) => (l.payerId === memberId ? { ...l, payerId: undefined } : l)),
      income: b.income.filter((i) => i.memberId !== memberId),
    }));
    setSelected(null);
  }

  const adminCount = budget.members.filter((m) => m.role === 'admin').length;

  return (
    <>
      <Card
        title={budget.household.name}
        action={
          isAdmin ? (
            <button className="btn btn-small" onClick={() => setInviting(true)}>
              Bjud in
            </button>
          ) : undefined
        }
      >
        <div className="list">
          {budget.members.map((member) => (
            <ListRow
              key={member.id}
              title={member.name}
              badge={
                member.status === 'invited'
                  ? 'Inbjuden'
                  : member.role === 'admin'
                    ? 'Admin'
                    : undefined
              }
              subtitle={member.email + (member.id === me.id ? ' · du' : '')}
              amount={member.status === 'active' ? sek(member.baselineIncome) : '—'}
              amountNote={member.status === 'active' ? 'normal/mån' : 'ej ansluten'}
              onClick={isAdmin ? () => setSelected(member) : undefined}
            />
          ))}
        </div>
        {!isAdmin && (
          <div style={{ marginTop: 12 }}>
            <Note>Bara administratörer kan bjuda in eller ta bort medlemmar.</Note>
          </div>
        )}
      </Card>

      <Card title="Utvecklingsläge">
        <div style={{ marginBottom: 12 }}>
          <Note>
            Inloggning är inte påkopplad än, så identiteten avgörs av vald medlem. Byt medlem för
            att se appen ur någon annans vy.
          </Note>
        </div>
        <Field label="Inloggad som">
          <select value={me.id} onChange={(e) => signInAs(e.target.value)}>
            {budget.members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} ({m.role})
              </option>
            ))}
          </select>
        </Field>
        <button className="btn btn-secondary" onClick={reset}>
          Logga ut
        </button>
      </Card>

      {inviting && (
        <Sheet title="Bjud in till hushållet" onClose={() => setInviting(false)}>
          <Field label="E-postadress" hint="Måste vara adressen personen loggar in med via Google.">
            <input
              autoFocus
              type="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setError('');
              }}
              placeholder="namn@example.com"
            />
          </Field>
          <Field label="Namn (valfritt)">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Förnamn" />
          </Field>
          {error && (
            <p className="note" style={{ color: 'var(--critical)' }}>
              {error}
            </p>
          )}
          <Note>
            Personen räknas inte med i fördelningen förrän hen loggat in första gången.
          </Note>
          <div className="btn-row">
            <button className="btn btn-secondary" onClick={() => setInviting(false)}>
              Avbryt
            </button>
            <button className="btn" onClick={invite}>
              Bjud in
            </button>
          </div>
        </Sheet>
      )}

      {selected && (
        <Sheet title={selected.name} onClose={() => setSelected(null)}>
          <Field label="Roll">
            <select
              value={selected.role}
              disabled={selected.role === 'admin' && adminCount === 1}
              onChange={(e) => changeRole(selected.id, e.target.value as Role)}
            >
              <option value="member">Medlem</option>
              <option value="admin">Administratör</option>
            </select>
          </Field>
          {selected.role === 'admin' && adminCount === 1 && (
            <Note>Hushållet måste ha minst en administratör.</Note>
          )}
          <div className="btn-row">
            <button
              className="btn btn-danger"
              disabled={selected.id === me.id}
              onClick={() => {
                if (confirm(`Ta bort ${selected.name} från hushållet?`)) removeMember(selected.id);
              }}
            >
              Ta bort
            </button>
            <button className="btn btn-secondary" onClick={() => setSelected(null)}>
              Klar
            </button>
          </div>
        </Sheet>
      )}
    </>
  );
}
