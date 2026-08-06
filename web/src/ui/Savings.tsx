import { useState } from 'react';
import { useBudget, newId } from '../store/store';
import type { Saving, SavingTerms } from '../domain/types';
import { isCostPaused, pausedFrom, savingAmountAt } from '../domain/engine';
import { sek } from '../domain/format';
import { currentMonth, formatMonth } from '../domain/month';
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
import { useText } from '../i18n';

/**
 * Your own long-term saving. Lives on the profile rather than the income tab
 * because it is yours rather than the household's: nobody else's copy of the app
 * ever receives these rows.
 */
export function Savings() {
  const { budget, me, update } = useBudget();
  const t = useText();
  const thisMonth = currentMonth();

  const [draft, setDraft] = useState<Saving | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [actionsFor, setActionsFor] = useState<Saving | null>(null);
  const [termsFor, setTermsFor] = useState<Saving | null>(null);
  const [termsDraft, setTermsDraft] = useState<SavingTerms | null>(null);

  function updateSavings(fn: (savings: Saving[]) => Saving[]) {
    update((b) => ({ ...b, savings: fn(b.savings) }));
  }

  function save() {
    if (!draft || !draft.name.trim()) return;
    const saving = { ...draft, name: draft.name.trim() };
    updateSavings((savings) =>
      isNew ? [...savings, saving] : savings.map((s) => (s.id === saving.id ? saving : s)),
    );
    setDraft(null);
  }

  function remove(saving: Saving) {
    updateSavings((savings) => savings.filter((s) => s.id !== saving.id));
    setDraft(null);
    setActionsFor(null);
  }

  /** Closes the open stretch at this month, exactly as pausing a cost does. */
  function pause(saving: Saving) {
    const periods = saving.periods && saving.periods.length > 0 ? [...saving.periods] : [{}];
    const last = periods[periods.length - 1];
    if (last.to) return;
    periods[periods.length - 1] = { ...last, to: thisMonth };
    updateSavings((savings) => savings.map((s) => (s.id === saving.id ? { ...s, periods } : s)));
    setActionsFor(null);
  }

  function resume(saving: Saving) {
    const periods = [...(saving.periods ?? []), { from: thisMonth }];
    updateSavings((savings) => savings.map((s) => (s.id === saving.id ? { ...s, periods } : s)));
    setActionsFor(null);
  }

  function openTerms(saving: Saving) {
    setTermsFor(saving);
    setTermsDraft({ from: thisMonth, amount: savingAmountAt(saving, thisMonth) });
    setActionsFor(null);
  }

  function saveTerms() {
    if (!termsFor || !termsDraft) return;
    const terms = [
      ...(termsFor.terms ?? []).filter((e) => e.from !== termsDraft.from),
      termsDraft,
    ].sort((a, b) => a.from.localeCompare(b.from));
    updateSavings((savings) => savings.map((s) => (s.id === termsFor.id ? { ...s, terms } : s)));
    setTermsFor(null);
    setTermsDraft(null);
  }

  function removeTerms(from: string) {
    if (!termsFor) return;
    const terms = (termsFor.terms ?? []).filter((e) => e.from !== from);
    updateSavings((savings) => savings.map((s) => (s.id === termsFor.id ? { ...s, terms } : s)));
    setTermsFor({ ...termsFor, terms });
  }

  return (
    <>
      <Card
        title={t.savings}
        action={
          <button
            className="btn btn-small"
            onClick={() => {
              setDraft({ id: newId(), memberId: me.id, name: '', amount: 0 });
              setIsNew(true);
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
                onClick={() => setActionsFor(saving)}
              />
            );
          })}
        </div>
      </Card>

      {actionsFor && (
        <ActionSheet
          title={actionsFor.name}
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
            { label: t.changeSaving, onSelect: () => openTerms(actionsFor) },
            isCostPaused(actionsFor, thisMonth)
              ? { label: t.resume, onSelect: () => resume(actionsFor) }
              : { label: t.pause, onSelect: () => pause(actionsFor) },
            {
              label: t.remove,
              danger: true,
              onSelect: () => {
                if (confirm(t.confirmRemove(actionsFor.name))) remove(actionsFor);
              },
            },
          ]}
        />
      )}

      {draft && (
        <Sheet title={isNew ? t.newSaving : t.editSaving} onClose={() => setDraft(null)}>
          <Field label={t.description}>
            <input
              autoFocus
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder={t.savingPlaceholder}
            />
          </Field>
          {isNew ? (
            <Field label={t.amountPerMonthLabel}>
              <AmountInput
                value={draft.amount || ''}
                onChange={(amount) => setDraft({ ...draft, amount })}
                step={100}
              />
            </Field>
          ) : (
            <div className="field">
              <label>{t.currentSaving}</label>
              <div className="terms-current">
                <span>{sek(savingAmountAt(draft, thisMonth))}</span>
                <span>{t.perMonth}</span>
              </div>
              <span className="hint">{t.changeSavingHint}</span>
            </div>
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

      {termsFor && termsDraft && (
        <Sheet title={t.changeSaving} onClose={() => setTermsFor(null)}>
          <Field label={t.appliesFrom} hint={t.appliesFromHintSaving}>
            <MonthInput
              value={termsDraft.from}
              onChange={(from) => setTermsDraft({ ...termsDraft, from })}
            />
          </Field>
          <Field label={t.amountPerMonthLabel}>
            <AmountInput
              value={termsDraft.amount || ''}
              onChange={(amount) => setTermsDraft({ ...termsDraft, amount })}
              step={100}
            />
          </Field>

          {(termsFor.terms ?? []).length > 0 && (
            <div className="field">
              <label>{t.termsHistory}</label>
              <div className="list">
                {[...(termsFor.terms ?? [])]
                  .sort((a, b) => b.from.localeCompare(a.from))
                  .map((entry) => (
                    <ListRow
                      key={entry.from}
                      title={formatMonth(entry.from)}
                      amount={sek(entry.amount)}
                      onClick={() => removeTerms(entry.from)}
                    />
                  ))}
              </div>
              <span className="hint">{t.termsHistoryHint}</span>
            </div>
          )}

          <div className="btn-row">
            <button className="btn btn-secondary" onClick={() => setTermsFor(null)}>
              {t.cancel}
            </button>
            <button className="btn" onClick={saveTerms}>
              {t.save}
            </button>
          </div>
        </Sheet>
      )}
    </>
  );
}
