import { forwardRef, type ComponentPropsWithoutRef } from 'react';

/**
 * The app's button variants: a native button styled with the ADS button
 * tokens (styles/components/buttons.css). Native rather than @atlaskit/button
 * keeps ~66 kB gzip out of the initial bundle; the look, sizes and states
 * follow ADS.
 *
 * - primary: the one main action on a screen (ADS brand blue: Jira users read blue as "the action")
 * - secondary: any other action; it has a visible fill, so it never reads as plain text
 * - subtle: dismissive only (Cancel, Keep going), beside a stronger action
 * - danger: destructive (Discard)
 */
export type ButtonVariant = 'primary' | 'secondary' | 'subtle' | 'danger';

type ButtonProps = Omit<ComponentPropsWithoutRef<'button'>, 'disabled'> & {
  variant?: ButtonVariant;
  spacing?: 'default' | 'compact';
  isDisabled?: boolean;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', spacing = 'default', isDisabled, className, type = 'button', ...props },
  ref,
) {
  const classes = ['btn', `btn-${variant}`, spacing === 'compact' ? 'btn-compact' : '', className]
    .filter(Boolean)
    .join(' ');
  return <button {...props} ref={ref} type={type} className={classes} disabled={isDisabled} />;
});
