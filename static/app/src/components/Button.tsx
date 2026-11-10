import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from 'react';
import AkButton from '@atlaskit/button/new';

/**
 * The app's button variants over the ADS button.
 *
 * - primary: the one main action on a screen (ADS brand blue: Jira users read blue as "the action")
 * - secondary: any other action; it has a visible fill, so it never reads as plain text
 * - subtle: dismissive only (Cancel, Keep going), beside a stronger action
 * - danger: destructive (Discard)
 */
export type ButtonVariant = 'primary' | 'secondary' | 'subtle' | 'danger';

const APPEARANCE = {
  primary: 'primary',
  secondary: 'default',
  subtle: 'subtle',
  danger: 'danger',
} as const;

type AkProps = ComponentPropsWithoutRef<typeof AkButton>;

export const Button = forwardRef<
  ElementRef<typeof AkButton>,
  Omit<AkProps, 'appearance'> & { variant?: ButtonVariant }
>(function Button({ variant = 'secondary', ...props }, ref) {
  return <AkButton {...props} ref={ref} appearance={APPEARANCE[variant]} />;
});
