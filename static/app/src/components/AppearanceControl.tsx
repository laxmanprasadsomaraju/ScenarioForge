import { useId } from 'react';
import { APPEARANCES, useAppearance, type Appearance } from '../lib/appearance';

/**
 * Match Jira (Match device outside Jira), Light, Dark: a segmented group of
 * native radios, so arrow keys move the choice and it reads as one question.
 */
export function AppearanceControl({ compact = false }: { compact?: boolean }) {
  const { appearance, setAppearance, hostThemed } = useAppearance();
  const name = useId();
  const labels: Record<Appearance, string> = {
    system: hostThemed === false ? 'Match device' : 'Match Jira',
    light: 'Light',
    dark: 'Dark',
  };
  return (
    <fieldset className={compact ? 'appearance appearance-compact' : 'appearance'}>
      <legend className="appearance-legend">Appearance</legend>
      <div className="segmented">
        {APPEARANCES.map((value) => (
          <label key={value} className="segment">
            <input
              type="radio"
              name={name}
              value={value}
              checked={appearance === value}
              onChange={() => setAppearance(value)}
            />
            <span>{labels[value]}</span>
          </label>
        ))}
      </div>
      {!compact && appearance !== 'system' && hostThemed !== false ? (
        <p className="appearance-note">
          Your choice applies to ScenarioForge only, so it can differ from the rest of Jira.
        </p>
      ) : null}
    </fieldset>
  );
}
