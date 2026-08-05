import { useState } from 'react';
import { useStore, useBudget, newId } from '../store/store';
import type { Language, Member, Role, ThemeChoice } from '../domain/types';
import { sek } from '../domain/format';
import { Card, Field, ListRow, Note, Sheet } from './components';
import { api } from '../api/client';
import { defaultLanguage, rememberLanguage } from '../settings';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function Household() {
  const { budget, me, isAdmin, update } = useBudget();
  const { signOut, email: signedInEmail } = useStore();
  const [inviting, setInviting] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<Member | null>(null);
  const [resend, setResend] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');

  async function resendInvite(member: Member) {
    setResend('sending');
    try {
      await api.resendInvite(member.id);
      setResend('sent');
    } catch {
      setResend('error');
    }
  }

  function openMember(member: Member) {
    setResend('idle');
    setSelected(member);
  }

  /** Preferences are per person, so they always write to your own member record. */
  function setLanguage(language: Language) {
    rememberLanguage(language);
    update((b) => ({
      ...b,
      members: b.members.map((m) => (m.id === me.id ? { ...m, language } : m)),
    }));
  }

  function setTheme(theme: ThemeChoice) {
    update((b) => ({
      ...b,
      members: b.members.map((m) => (m.id === me.id ? { ...m, theme } : m)),
    }));
  }

  function rename() {
    const cleaned = renaming?.trim();
    if (!cleaned) return;
    update((b) => ({ ...b, household: { ...b.household, name: cleaned } }));
    setRenaming(null);
  }

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
            <span className="card-actions">
              <button
                className="btn btn-small btn-secondary"
                onClick={() => setRenaming(budget.household.name)}
              >
                Byt namn
              </button>
              <button className="btn btn-small" onClick={() => setInviting(true)}>
                Bjud in
              </button>
            </span>
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
              onClick={isAdmin ? () => openMember(member) : undefined}
            />
          ))}
        </div>
        {!isAdmin && (
          <div style={{ marginTop: 12 }}>
            <Note>
              Bara administratörer kan byta namn på hushållet, bjuda in eller ta bort medlemmar.
            </Note>
          </div>
        )}
      </Card>

      <Card title="Konto">
        <div style={{ marginBottom: 12 }}>
          <Note>
            Inloggad som <strong>{signedInEmail}</strong> via Google.
          </Note>
        </div>

        <Field label="Språk">
          <select
            value={me.language ?? defaultLanguage()}
            onChange={(e) => setLanguage(e.target.value as Language)}
          >
            <option value="sv">Svenska</option>
            <option value="en">English</option>
          </select>
        </Field>

        <Field label="Utseende">
          <select
            value={me.theme ?? 'system'}
            onChange={(e) => setTheme(e.target.value as ThemeChoice)}
          >
            <option value="system">Systemets inställning</option>
            <option value="light">Ljust</option>
            <option value="dark">Mörkt</option>
          </select>
        </Field>

        <button className="btn btn-secondary" onClick={() => void signOut()}>
          Logga ut
        </button>
      </Card>

      {renaming !== null && (
        <Sheet title="Byt namn på hushållet" onClose={() => setRenaming(null)}>
          <Field label="Hushållets namn">
            <input
              autoFocus
              value={renaming}
              onChange={(e) => setRenaming(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && rename()}
              placeholder="t.ex. Familjen Svensson"
            />
          </Field>
          <Note>Namnet syns för alla i hushållet och i inbjudningar som skickas per e-post.</Note>
          <div className="btn-row">
            <button className="btn btn-secondary" onClick={() => setRenaming(null)}>
              Avbryt
            </button>
            <button className="btn" disabled={renaming.trim() === ''} onClick={rename}>
              Spara
            </button>
          </div>
        </Sheet>
      )}

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

          <div className="field">
            <label>Inbjudan</label>
            <button
              className="btn btn-secondary"
              style={{ alignSelf: 'flex-start' }}
              disabled={resend === 'sending'}
              onClick={() => void resendInvite(selected)}
            >
              {resend === 'sending' ? 'Skickar…' : 'Skicka inbjudan igen'}
            </button>
            {resend === 'sent' && <span className="hint">Skickad till {selected.email}.</span>}
            {resend === 'error' && (
              <span className="hint" style={{ color: 'var(--neg)' }}>
                Inbjudan kunde inte skickas.
              </span>
            )}
            {resend === 'idle' && (
              <span className="hint">Mejlar en länk till appen. Adressen kopplas till hushållet.</span>
            )}
          </div>

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
