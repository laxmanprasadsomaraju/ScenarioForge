import { useEffect, useState } from 'react';
import { rovo } from '@forge/bridge';
import { Button } from './Button';
import { bridgeCall } from '../lib/preview';

/**
 * Whether Rovo is enabled on this site, from `rovo.isEnabled()` in
 * @forge/bridge. `false` until it resolves, and stays `false` if the bridge
 * rejects or throws (outside Jira, older hosts), so nothing renders by default.
 */
export function useRovoEnabled(): boolean {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    let live = true;
    bridgeCall(() => rovo.isEnabled()).then(
      (value) => {
        if (live) setEnabled(value === true);
      },
      () => {
        if (live) setEnabled(false);
      },
    );
    return () => {
      live = false;
    };
  }, []);
  return enabled;
}

/** The agents ScenarioForge declares (`rovo:agent` keys in the manifest that ships them). */
const AGENTS = {
  investigator: {
    agentKey: 'recovery-investigator',
    agentName: 'Recovery Investigator',
    label: 'Ask the investigator',
  },
} as const;

/**
 * Opens Rovo chat with a ScenarioForge agent and a prompt. Renders nothing
 * unless Rovo is enabled; if opening fails (for example the agent is not
 * installed on this site) the entry hides itself rather than stay as a dead
 * control.
 */
export function AskRovo({ agent, prompt }: { agent: keyof typeof AGENTS; prompt: string }) {
  const enabled = useRovoEnabled();
  const [failed, setFailed] = useState(false);
  if (!enabled || failed) return null;
  const { agentKey, agentName, label } = AGENTS[agent];
  return (
    <div className="ask-rovo">
      <Button
        spacing="compact"
        onClick={() => {
          bridgeCall(() => rovo.open({ type: 'forge', agentKey, agentName, prompt })).catch(() =>
            setFailed(true),
          );
        }}
      >
        {label}
      </Button>
    </div>
  );
}
