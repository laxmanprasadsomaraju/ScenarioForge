import Spinner from '@atlaskit/spinner';
import Button from '@atlaskit/button/new';
import { useCallback } from 'react';
import { api } from '../lib/api';
import { useApi } from '../lib/useApi';

export function useConnection() {
  const load = useCallback(() => api.getConnectionStatus(), []);
  return useApi(load);
}

/** Compact live status of the asUser Jira connection. */
export function ConnectionStatusLine() {
  const { state, retry } = useConnection();
  if (state.status === 'loading') {
    return (
      <span className="conn conn-checking" role="status">
        <Spinner size="small" label="Checking" /> Checking Jira connection
      </span>
    );
  }
  if (state.status === 'error') {
    return (
      <span className="conn conn-error" role="status">
        <span>Jira not connected</span>
        <Button appearance="subtle" spacing="compact" onClick={retry}>
          Retry
        </Button>
      </span>
    );
  }
  return (
    <span className="conn conn-ok" role="status">
      Connected to Jira{state.data.userDisplayName ? ` as ${state.data.userDisplayName}` : ''}
    </span>
  );
}
