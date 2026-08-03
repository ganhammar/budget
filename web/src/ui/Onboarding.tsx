import { useState } from 'react';
import { useStore } from '../store/store';
import { Field, Note } from './components';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function Onboarding() {
  const { createHousehold, error } = useStore();
  const [household, setHousehold] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');

  const valid = household.trim() !== '' && name.trim() !== '' && EMAIL.test(email.trim());

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
          placeholder="t.ex. Familjen Ganhammar"
        />
      </Field>
      <Field label="Ditt namn">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Förnamn" />
      </Field>
      <Field label="Din e-post" hint="Samma adress som du loggar in med via Google.">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="namn@example.com"
        />
      </Field>

      {error && <p className="note error">{error}</p>}

      <div className="btn-row">
        <button
          className="btn"
          disabled={!valid}
          onClick={() =>
            void createHousehold(household.trim(), name.trim(), email.trim().toLowerCase())
          }
        >
          Skapa hushåll
        </button>
      </div>

      <div style={{ marginTop: 24 }}>
        <Note>
          Inloggning med Google är inte påkopplad än. Tills vidare identifieras du enbart av
          e-postadressen du anger här.
        </Note>
      </div>
    </div>
  );
}
