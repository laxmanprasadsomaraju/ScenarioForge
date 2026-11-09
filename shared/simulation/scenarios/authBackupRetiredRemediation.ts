import type { ScenarioRemediationModel } from '../types';

/**
 * DEMO REMEDIATION DATA — synthetic fixtures (origin: 'demo') for
 * `demo-auth-backup-retired` v1.
 *
 * `rem-runbook` corrects RB-AUTH-01 step 3 so that following the runbook
 * promotes NimbusID. In the remediated version, `follow-runbook` restores
 * sign-in at T+8 and leads to a post-recovery communication step.
 *
 * `rem-change-checklist` is a process change for future identity provider
 * changes. It does not alter this rehearsal, so on its own it cannot resolve
 * the stale-runbook gap.
 *
 * Retest optimal path (with rem-runbook): follow-runbook -> notify-restored
 * (11 min, 4/4 objectives).
 */
export const authBackupRetiredRemediation: ScenarioRemediationModel = {
  scenarioId: 'demo-auth-backup-retired',
  baseVersion: 1,
  effects: {
    'rem-runbook': [
      {
        kind: 'replaceProcedureStep',
        step: {
          order: 3,
          instruction:
            'If the primary IdP is unavailable for more than 5 minutes, promote NimbusID: ' +
            'Admin console > Identity > Promote secondary (LegacyAuth was retired by DEMO-CHG-101).',
          dependsOn: ['nimbusid'],
        },
      },
      {
        kind: 'replaceEvidence',
        evidence: {
          id: 'ev-runbook-step3',
          origin: 'demo',
          kind: 'runbook-step',
          title: 'RB-AUTH-01 step 3',
          excerpt:
            'If the primary IdP is unavailable for more than 5 minutes, promote NimbusID: ' +
            'Admin console > Identity > Promote secondary (LegacyAuth was retired by DEMO-CHG-101).',
        },
      },
      {
        kind: 'replaceEvidence',
        evidence: {
          id: 'ev-runbook-review',
          origin: 'demo',
          kind: 'runbook-step',
          title: 'RB-AUTH-01 review history',
          excerpt:
            'Last reviewed 2026-03-14. Step 3 updated by remediation rem-runbook to reflect DEMO-CHG-101.',
        },
      },
      {
        kind: 'replaceDecision',
        stepId: 'detect',
        decision: {
          id: 'follow-runbook',
          label: 'Follow RB-AUTH-01 step 3: promote NimbusID',
          detail: 'Admin console > Identity > Promote secondary, as the updated runbook instructs.',
          consequence: {
            minutes: 8,
            setFlags: ['runbookGapIdentified', 'loginRestored'],
            narrative:
              'Step 3 now records that DEMO-CHG-101 retired LegacyAuth and directs you to NimbusID. ' +
              'NimbusID takes over and sign-in success returns to normal.',
            evidenceIds: ['ev-runbook-step3', 'ev-change'],
            assessment: 'effective',
          },
          next: 'post-recovery-comms',
        },
      },
      {
        kind: 'addStep',
        step: {
          id: 'post-recovery-comms',
          title: 'Close the loop',
          situation:
            'Sign-in is restored through NimbusID. Support still has open tickets from the outage. ' +
            'How do you handle communication?',
          decisions: [
            {
              id: 'notify-restored',
              label: 'Post a status update and brief the support lead now',
              consequence: {
                minutes: 3,
                setFlags: ['stakeholdersNotified'],
                narrative: 'Customers and support learn that sign-in has been restored.',
                evidenceIds: ['ev-service'],
                assessment: 'effective',
              },
              next: null,
            },
            {
              id: 'skip-comms',
              label: 'Skip the update now that sign-in works',
              consequence: {
                minutes: 0,
                narrative:
                  'No update is sent. Support keeps answering outage tickets without guidance.',
                evidenceIds: ['ev-service'],
                assessment: 'harmful',
              },
              next: null,
            },
          ],
        },
      },
      {
        kind: 'replaceSituation',
        stepId: 'recover-uninformed',
        situation:
          'Sign-in is still failing and SSO enforcement was relaxed. How do you restore sign-in?',
      },
      {
        kind: 'replaceDecision',
        stepId: 'recover-uninformed',
        decision: {
          id: 'investigate-failover',
          label: 'Check RB-AUTH-01 and recent identity changes',
          consequence: {
            minutes: 6,
            setFlags: ['runbookGapIdentified'],
            narrative:
              'Updated step 3 cites DEMO-CHG-101: LegacyAuth was retired and NimbusID is the secondary IdP.',
            evidenceIds: ['ev-change', 'ev-runbook-step3'],
            assessment: 'effective',
          },
          next: 'recover',
        },
      },
    ],
    'rem-change-checklist': [],
  },
  gaps: [
    {
      findingId: 'demo-finding-stale-failover',
      title: 'RB-AUTH-01 step 3 fails over to the retired LegacyAuth tenant',
      remediationIds: ['rem-runbook'],
      objectiveIds: ['obj-restore'],
      exerciseDecisions: [
        { stepId: 'detect', decisionId: 'follow-runbook' },
        { stepId: 'failover-failed', decisionId: 'retry-failover' },
      ],
    },
  ],
};
