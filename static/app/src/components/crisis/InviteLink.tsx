import { useEffect, useRef, useState } from 'react';
import { router } from '@forge/bridge';
import { crisisInvitePath } from '@shared/links/crisisLink';
import { Button } from '../Button';
import { bridgeCall } from '../../lib/preview';
import { formatAbsolute } from '../../lib/format';
import type { IssuedInvite } from '../../lib/useCrisisRoom';
import { ROLE_NAME } from './parts';

const GLOBAL_PAGE = 'scenarioforge-global-full-page';

/**
 * A freshly issued invite: the link (Jira's URL for the app page when Forge
 * can build it, the app path otherwise) with a copy button. The token is in
 * this tab only; it is not shown again after a reload.
 */
export function InviteLink({ roomId, invite }: { roomId: string; invite: IssuedInvite }) {
  const path = crisisInvitePath(roomId, invite.token);
  const [link, setLink] = useState(path);
  const [copied, setCopied] = useState<'idle' | 'copied' | 'failed'>('idle');
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let live = true;
    bridgeCall(() => router.getUrl({ target: 'module', moduleKey: GLOBAL_PAGE, path }))
      .then((url) => {
        if (live && url) setLink(url.toString());
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [path]);

  const copy = () => {
    input.current?.select();
    Promise.resolve()
      .then(() => navigator.clipboard.writeText(link))
      .then(() => setCopied('copied'))
      .catch(() => setCopied('failed'));
  };

  const id = `invite-${invite.inviteId}`;
  return (
    <div className="crisis-invite-link">
      <label className="field field-grow" htmlFor={id}>
        <span className="field-label">
          {ROLE_NAME[invite.role]} invite, expires {formatAbsolute(invite.expiresAt)}
        </span>
      </label>
      <div className="crisis-invite-copy">
        <input id={id} ref={input} readOnly value={link} onFocus={(e) => e.target.select()} />
        <Button spacing="compact" onClick={copy}>
          Copy link
        </Button>
      </div>
      <p className="crisis-invite-note" role="status">
        {copied === 'copied'
          ? 'Copied. Send it to one person.'
          : copied === 'failed'
            ? 'Copy did not work here; select the link and copy it by hand.'
            : 'Shown once: it will not be shown again after you leave this page.'}
      </p>
    </div>
  );
}
