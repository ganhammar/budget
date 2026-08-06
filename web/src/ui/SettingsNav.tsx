import { useBudget } from '../store/store';
import { useText } from '../i18n';

/**
 * Which scope you are editing: the household, or yourself. Both screens carry it,
 * so the answer to "whose setting is this" is on screen rather than inferred from
 * a card heading.
 *
 * These two get icons where the bottom nav deliberately has none. There the labels
 * are distinct enough to stand alone; here the whole point is the shared/personal
 * distinction, and a house against a person says that faster than two words do.
 */
export function SettingsNav({ active }: { active: 'household' | 'profile' }) {
  const { me } = useBudget();
  const t = useText();
  // The member name is already a given name in practice, but a full name would
  // overflow the row, so only the first part is shown.
  const firstName = me.name.trim().split(/\s+/)[0] || t.profile;

  return (
    <nav className="settings-nav">
      <a href="#household" className={active === 'household' ? 'active' : ''}>
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path
            d="M2.5 7 8 2.5 13.5 7v6a.5.5 0 0 1-.5.5H3a.5.5 0 0 1-.5-.5V7Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
        </svg>
        {t.household}
      </a>
      <a href="#profile" className={active === 'profile' ? 'active' : ''}>
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
        {firstName}
      </a>
    </nav>
  );
}
