import type { ReactNode } from 'react';
import { useBudget } from '../store/store';
import { Household } from './Household';
import { Profile } from './Profile';
import { useText } from '../i18n';

/**
 * The scope marker for a group of settings. One page holds both halves, so each
 * needs to announce whose it is: the icon carries shared-versus-personal at a
 * glance and the label names it.
 */
function SectionDivider({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <div className="settings-section">
      {icon}
      <span>{label}</span>
    </div>
  );
}

const houseIcon = (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <path
      d="M2.5 7 8 2.5 13.5 7v6a.5.5 0 0 1-.5.5H3a.5.5 0 0 1-.5-.5V7Z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinejoin="round"
    />
  </svg>
);

const personIcon = (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <circle cx="8" cy="5.5" r="2.6" fill="none" stroke="currentColor" strokeWidth="1.4" />
    <path
      d="M3 13.5c0-2.5 2.2-4 5-4s5 1.5 5 4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
    />
  </svg>
);

export function Settings() {
  const { me } = useBudget();
  const t = useText();
  // A full name would overflow the row, so only the given name is shown.
  const firstName = me.name.trim().split(/\s+/)[0] || t.profile;

  return (
    <>
      <SectionDivider icon={houseIcon} label={t.household} />
      <Household />

      <SectionDivider icon={personIcon} label={firstName} />
      <Profile />
    </>
  );
}
