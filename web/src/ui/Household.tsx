import { useState } from 'react';
import { useBudget, newId } from '../store/store';
import type { Member, Role, SplitRule } from '../domain/types';
import { sek } from '../domain/format';
import { Card, Field, ListRow, Note, Sheet } from './components';
import { api } from '../api/client';
import { useText } from '../i18n';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function Household() {
  const { budget, me, isAdmin, update } = useBudget();
  const t = useText();
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

  function rename() {
    const cleaned = renaming?.trim();
    if (!cleaned) return;
    update((b) => ({ ...b, household: { ...b.household, name: cleaned } }));
    setRenaming(null);
  }

  function invite() {
    const cleaned = email.trim().toLowerCase();
    if (!EMAIL.test(cleaned)) {
      setError(t.invalidEmail);
      return;
    }
    if (budget.members.some((m) => m.email.toLowerCase() === cleaned)) {
      setError(t.duplicateEmail);
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

  function setSplit(split: SplitRule) {
    update((b) => ({ ...b, household: { ...b.household, split } }));
  }

  const adminCount = budget.members.filter((m) => m.role === 'admin').length;
  const split = budget.household.split ?? 'equalLeftover';

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
                {t.rename}
              </button>
              <button className="btn btn-small" onClick={() => setInviting(true)}>
                {t.invite}
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
                  ? t.badgeInvited
                  : member.role === 'admin'
                    ? t.badgeAdmin
                    : undefined
              }
              subtitle={member.email + (member.id === me.id ? ` · ${t.you}` : '')}
              amount={member.status === 'active' ? sek(member.baselineIncome) : '—'}
              amountNote={member.status === 'active' ? t.normalPerMonth : t.notConnected}
              onClick={isAdmin ? () => openMember(member) : undefined}
            />
          ))}
        </div>
        {/* The one contested decision in the model, so it says in words what it
            does rather than leaving people to infer it from the numbers. */}
        <div className="household-split">
          <Field
            label={t.splitRule}
            hint={
              split === 'byIncome'
                ? t.splitHintByIncome
                : split === 'even'
                  ? t.splitHintEven
                  : t.splitHintEqualLeftover
            }
          >
            <select
              value={split}
              disabled={!isAdmin}
              onChange={(e) => setSplit(e.target.value as SplitRule)}
            >
              <option value="equalLeftover">{t.splitEqualLeftover}</option>
              <option value="byIncome">{t.splitByIncome}</option>
              <option value="even">{t.splitEven}</option>
            </select>
          </Field>
        </div>

        {!isAdmin && (
          <div style={{ marginTop: 12 }}>
            <Note>
              {t.adminOnlyNote}
            </Note>
          </div>
        )}
      </Card>

      {renaming !== null && (
        <Sheet title={t.renameHousehold} onClose={() => setRenaming(null)}>
          <Field label={t.householdName}>
            <input
              autoFocus
              value={renaming}
              onChange={(e) => setRenaming(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && rename()}
              placeholder={t.householdNamePlaceholder}
            />
          </Field>
          <Note>{t.renameNote}</Note>
          <div className="btn-row">
            <button className="btn btn-secondary" onClick={() => setRenaming(null)}>
              {t.cancel}
            </button>
            <button className="btn" disabled={renaming.trim() === ''} onClick={rename}>
              {t.save}
            </button>
          </div>
        </Sheet>
      )}

      {inviting && (
        <Sheet title={t.inviteToHousehold} onClose={() => setInviting(false)}>
          <Field label={t.emailAddress} hint={t.emailHint}>
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
          <Field label={t.nameOptional}>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t.firstNamePlaceholder} />
          </Field>
          {error && (
            <p className="note" style={{ color: 'var(--critical)' }}>
              {error}
            </p>
          )}
          <Note>
            {t.inviteNote}
          </Note>
          <div className="btn-row">
            <button className="btn btn-secondary" onClick={() => setInviting(false)}>
              {t.cancel}
            </button>
            <button className="btn" onClick={invite}>
              {t.invite}
            </button>
          </div>
        </Sheet>
      )}

      {selected && (
        <Sheet title={selected.name} onClose={() => setSelected(null)}>
          <Field label={t.role}>
            <select
              value={selected.role}
              disabled={selected.role === 'admin' && adminCount === 1}
              onChange={(e) => changeRole(selected.id, e.target.value as Role)}
            >
              <option value="member">{t.roleMember}</option>
              <option value="admin">{t.roleAdmin}</option>
            </select>
          </Field>
          {selected.role === 'admin' && adminCount === 1 && (
            <Note>{t.needOneAdmin}</Note>
          )}

          <div className="field">
            <label>{t.inviteSection}</label>
            <button
              className="btn btn-secondary"
              style={{ alignSelf: 'flex-start' }}
              disabled={resend === 'sending'}
              onClick={() => void resendInvite(selected)}
            >
              {resend === 'sending' ? t.sending : t.resendInvite}
            </button>
            {resend === 'sent' && <span className="hint">{t.sentTo(selected.email)}</span>}
            {resend === 'error' && (
              <span className="hint" style={{ color: 'var(--neg)' }}>
                {t.inviteFailed}
              </span>
            )}
            {resend === 'idle' && (
              <span className="hint">{t.inviteHint}</span>
            )}
          </div>

          <div className="btn-row">
            <button
              className="btn btn-danger"
              disabled={selected.id === me.id}
              onClick={() => {
                if (confirm(t.confirmRemoveMember(selected.name))) removeMember(selected.id);
              }}
            >
              {t.remove}
            </button>
            <button className="btn btn-secondary" onClick={() => setSelected(null)}>
              {t.done}
            </button>
          </div>
        </Sheet>
      )}
    </>
  );
}
