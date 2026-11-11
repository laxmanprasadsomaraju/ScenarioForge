/**
 * What this build of ScenarioForge is allowed to do, as declared in
 * manifest.yml. The Settings screen shows these words; a root test
 * (test/environment.test.ts) fails if they drift from the manifest, so the UI
 * never claims a permission the environment lacks.
 */
export interface ManifestScope {
  scope: string;
  product: 'Jira' | 'Confluence' | 'Forge';
  use: string;
}

export const MANIFEST_SCOPES: readonly ManifestScope[] = [
  {
    scope: 'read:jira-work',
    product: 'Jira',
    use: 'Search issues and read their summary, status, type and update time.',
  },
  {
    scope: 'read:jira-user',
    product: 'Jira',
    use: 'Read your own profile for the connection check.',
  },
  {
    scope: 'search:confluence',
    product: 'Confluence',
    use: 'Search for recovery runbooks. Returns titles and links only.',
  },
  {
    scope: 'read:page:confluence',
    product: 'Confluence',
    use: 'Read one runbook page body to find its steps.',
  },
  {
    scope: 'storage:app',
    product: 'Forge',
    use: 'Store rehearsal history, AI usage limits and team rooms in app storage. Off unless an admin enables it.',
  },
];

/** Scopes the plans name that this build does not request; shown as not granted. */
export const NOT_REQUESTED_SCOPES: readonly { scope: string; needed: string }[] = [
  { scope: 'write:jira-work', needed: 'creating fix work items in Jira' },
];
