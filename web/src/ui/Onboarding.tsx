import { useState } from 'react';
import { useStore } from '../store/store';
import { Field, Note } from './components';

export function Onboarding() {
  const { createHousehold, signOut, email, error } = useStore();
  const [household, setHousehold] = useState('');
  const [name, setName] = useState('');

  const valid = household.trim() !== '' && name.trim() !== '';

  return (
    <div className="onboarding">
      <h1>Skapa hushåll</h1>
      <p className="lead">
        Du blir administratör för hushållet och kan bjuda in fler efteråt. All budgetdata hör till
        det här hushållet.
      </p>

      <Field label="Hushållets namn">
        <input
          autoFocus
          value={household}
          onChange={(e) => setHousehold(e.target.value)}
          placeholder="t.ex. Familjen Svensson"
        />
      </Field>
      <Field label="Ditt namn">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Förnamn" />
      </Field>

      {error && <p className="note error">{error}</p>}

      <div className="btn-row">
        <button
          className="btn"
          disabled={!valid}
          onClick={() => void createHousehold(household.trim(), name.trim())}
        >
          Skapa hushåll
        </button>
      </div>

      <div style={{ marginTop: 24 }}>
        <Note>
          Inloggad som <strong>{email}</strong>. Har någon redan skapat ert hushåll behöver de bjuda
          in den här adressen i stället.{' '}
          <button
            className="btn btn-small btn-secondary"
            style={{ marginTop: 8 }}
            onClick={() => void signOut()}
          >
            Logga ut
          </button>
        </Note>
      </div>
    </div>
  );
}
