import Spinner from '@atlaskit/spinner';
import { Button } from './Button';
import { useCallback } from 'react';
import { api } from '../lib/api';
import { useApi } from '../lib/useApi';

export function useConnection() {
  const load = useCallback(() => api.getConnectionStatus(), []);
  return useApi(load);
}

/**
 * Compact live status of the asUser Jira connection. One status region stays
 * mounted across checking, connected and failed so each change is announced;
 * the retry button sits outside it.
 */
export function ConnectionStatusLine() {
  const { state, retry } = useConnection();
  const tone = state.status === 'loading' ? 'checking' : state.status === 'error' ? 'error' : 'ok';
  return (
    <span className={`conn conn-${tone}`}>
      {state.status === 'loading' ? <Spinner size="small" label="Checking" /> : null}
      <span role="status">
        {state.status === 'loading' ? 'Checking Jira connection' : null}
        {state.status === 'error' ? 'Jira not connected' : null}
        {state.status === 'ready'
          ? `Connected to Jira${state.data.userDisplayName ? ` as ${state.data.userDisplayName}` : ''}`
          : null}
      </span>
      {state.status === 'error' ? (
        <Button spacing="compact" onClick={retry} aria-label="Retry Jira connection">
          Retry
        </Button>
      ) : null}
    </span>
  );
}
