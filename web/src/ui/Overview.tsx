import { useMemo, useState } from 'react';
import { useBudget } from '../store/store';
import { calculateMonth, forecast } from '../domain/engine';
import { sek } from '../domain/format';
import { currentMonth, formatMonth } from '../domain/month';
import { Card, Empty, Field, MonthInput, Note, Stat } from './components';
import { ForecastChart, ForecastTable } from './ForecastChart';
import { IncomeBanner } from './IncomeBanner';

const FORECAST_MONTHS = 24;

export function Overview() {
  const { budget } = useBudget();
  const [month, setMonth] = useState(currentMonth());
  const [showTable, setShowTable] = useState(false);

  const result = useMemo(() => calculateMonth(budget, month), [budget, month]);
  const points = useMemo(() => forecast(budget, FORECAST_MONTHS), [budget]);

  const isEmpty =
    budget.recurringCosts.length === 0 && budget.loans.length === 0 && budget.members.length <= 1;

  return (
    <>
      <IncomeBanner />

      {isEmpty && (
        <Card title="Kom igång">
          <Note>
            Lägg in dina återkommande kostnader, lån och inkomster så räknas fördelningen fram här.
            Börja med <strong>Inkomst</strong> och <strong>Kostnader</strong>.
          </Note>
        </Card>
      )}

      <Card title="Månad">
        <Field label="Visar">
          <MonthInput value={month} onChange={setMonth} />
        </Field>
        <div className="hero">
          <span className="value">{sek(result.surplus)}</span>
          <span className="label">
            kvar att dela på {result.memberLines.length} ·{' '}
            <strong>{sek(result.surplusPerMember)}</strong> var
          </span>
        </div>
      </Card>

      <Card title="Utgifter">
        <div className="stat-grid">
          <Stat label="Inkomster" value={sek(result.totalIncome)} />
          <Stat label="Utgifter" value={sek(result.totalCosts)} />
          <Stat label="Gemensamma" value={sek(result.recurringTotal)} />
          <Stat label="Lån" value={sek(result.loanTotal)} />
          <Stat label="Engångskostnader" value={sek(result.oneOffTotal)} />
          <Stat
            label="Balans"
            value={sek(result.surplus)}
            tone={result.surplus < 0 ? 'negative' : 'positive'}
          />
        </div>
      </Card>

      <Card title={`Att överföra · ${formatMonth(month)}`}>
        {result.memberLines.length === 0 ? (
          <Empty text="Inga aktiva medlemmar." />
        ) : (
          result.memberLines.map((line) => (
            <div className="transfer" key={line.memberId}>
              <div className="transfer-name">{line.name}</div>
              <div className="transfer-headline">
                <span className="label">Till gemensamt konto</span>
                <span className={`value ${line.toTransfer < 0 ? 'negative' : ''}`}>
                  {sek(line.toTransfer)}
                </span>
              </div>
              <div className="transfer-line">
                <span>Inkomst</span>
                <span>{sek(line.income)}</span>
              </div>
              <div className="transfer-line">
                <span>Betalar själv</span>
                <span>{line.paidDirectly > 0 ? `−${sek(line.paidDirectly)}` : '—'}</span>
              </div>
              <div className="transfer-line">
                <span>Kvar till eget</span>
                <span>{sek(line.leftOver)}</span>
              </div>
            </div>
          ))
        )}
        <div style={{ marginTop: 12 }}>
          <Note>
            Alla får lika mycket kvar. Kostnader du betalar själv dras från din överföring, inte
            från fördelningen.
          </Note>
        </div>
      </Card>

      <Card
        title="Gemensamt konto framåt"
        action={
          points.length > 0 ? (
            <button className="btn btn-small btn-secondary" onClick={() => setShowTable((v) => !v)}>
              {showTable ? 'Graf' : 'Tabell'}
            </button>
          ) : undefined
        }
      >
        {points.length === 0 ? (
          <Empty text="Ange saldot på gemensamt konto under Inkomst för att se prognosen." />
        ) : showTable ? (
          <ForecastTable points={points} />
        ) : (
          <ForecastChart points={points} />
        )}
      </Card>
    </>
  );
}
