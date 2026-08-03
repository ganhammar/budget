import { useEffect } from 'react';
import type { ReactNode } from 'react';

export function Card({
  title,
  action,
  children,
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="card">
      {title &&
        (action ? (
          <div className="card-header">
            <h2>{title}</h2>
            {action}
          </div>
        ) : (
          <h2>{title}</h2>
        ))}
      {children}
    </section>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
}

export function AmountInput({
  value,
  onChange,
  step = 1,
  placeholder,
}: {
  value: number | '';
  onChange: (value: number) => void;
  step?: number;
  placeholder?: string;
}) {
  return (
    <input
      type="number"
      inputMode="decimal"
      step={step}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value === '' ? 0 : Number(e.target.value))}
      onFocus={(e) => e.target.select()}
    />
  );
}

export function MonthInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return <input type="month" value={value} onChange={(e) => onChange(e.target.value)} />;
}

export function Sheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={title}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

export function ListRow({
  title,
  subtitle,
  amount,
  amountNote,
  badge,
  onClick,
}: {
  title: string;
  subtitle?: string;
  amount: string;
  amountNote?: string;
  badge?: string;
  onClick?: () => void;
}) {
  return (
    <button type="button" className="row" onClick={onClick}>
      <span className="row-main">
        <span className="row-title">
          {title} {badge && <span className="badge">{badge}</span>}
        </span>
        {subtitle && <span className="row-sub">{subtitle}</span>}
      </span>
      <span className="row-amount">
        {amount}
        {amountNote && <span>{amountNote}</span>}
      </span>
    </button>
  );
}

export function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'positive' | 'negative';
}) {
  return (
    <div className="stat">
      <div className="label">{label}</div>
      <div className={`value ${tone ?? ''}`}>{value}</div>
    </div>
  );
}

export function Empty({ text }: { text: string }) {
  return <p className="empty">{text}</p>;
}

export function Note({ children }: { children: ReactNode }) {
  return <p className="note">{children}</p>;
}

/** Dropdown for choosing who pays a cost directly. */
export function PayerSelect({
  members,
  value,
  onChange,
}: {
  members: { id: string; name: string; status: string }[];
  value: string | undefined;
  onChange: (payerId: string | undefined) => void;
}) {
  return (
    <select value={value ?? ''} onChange={(e) => onChange(e.target.value || undefined)}>
      <option value="">Gemensamt</option>
      {members
        .filter((m) => m.status === 'active')
        .map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
    </select>
  );
}
