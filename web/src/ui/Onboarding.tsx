import { useState } from 'react';
import { useStore } from '../store/store';
import { Field, Note } from './components';
import { useText } from '../i18n';

export function Onboarding() {
  const { createHousehold, signOut, email, error } = useStore();
  const t = useText();
  const [household, setHousehold] = useState('');
  const [name, setName] = useState('');

  const valid = household.trim() !== '' && name.trim() !== '';

  return (
    <div className="onboarding">
      <h1>{t.createHousehold}</h1>
      <p className="lead">
        {t.onboardingLead}
      </p>

      <Field label={t.householdName}>
        <input
          autoFocus
          value={household}
          onChange={(e) => setHousehold(e.target.value)}
          placeholder={t.householdNamePlaceholder}
        />
      </Field>
      <Field label={t.yourName}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t.firstNamePlaceholder} />
      </Field>

      {error && <p className="note error">{error}</p>}

      <div className="btn-row">
        <button
          className="btn"
          disabled={!valid}
          onClick={() => void createHousehold(household.trim(), name.trim())}
        >
          {t.createHousehold}
        </button>
      </div>

      <div style={{ marginTop: 24 }}>
        <Note>
          {t.signedInAs} <strong>{email}</strong>. {t.onboardingAlreadyExists}{' '}
          <button
            className="btn btn-small btn-secondary"
            style={{ marginTop: 8 }}
            onClick={() => void signOut()}
          >
            {t.signOut}
          </button>
        </Note>
      </div>
    </div>
  );
}
