import { Notice } from '../States';
import type { ParsedLink } from '@shared/links/deepLink';

/** Shown when a link was refused as a whole; the screen below is the default one. */
export function RejectedLinkNotice({ link }: { link: Extract<ParsedLink, { kind: 'rejected' }> }) {
  return (
    <div role="status">
      <Notice tone="warning" title="This link could not be opened">
        <p>{link.reason} Nothing from it was applied.</p>
      </Notice>
    </div>
  );
}

/**
 * Shown when a link names a finding the user's own check did not produce:
 * no access to the page, changed text, or a different engine result. The
 * finding is never shown from the link itself.
 */
export function MissingFindingNotice({ changeKey }: { changeKey: string }) {
  return (
    <div role="status">
      <Notice tone="information" title="Linked finding not found">
        <p>
          This link points to a finding that is not in your current result for {changeKey}. Your
          current result is shown below.
        </p>
      </Notice>
    </div>
  );
}
