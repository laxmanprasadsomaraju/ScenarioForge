import type { SimulationScenario } from '../../domain/types';

/**
 * DEMO SCENARIO — every entity below is a synthetic fixture (origin: 'demo').
 * It does not read Jira, Confluence or JSM. It exists to establish the
 * exercise interaction before live evidence retrieval lands in M2/M3.
 *
 * Optimal path: check-changes -> notify-now -> activate-nimbus (4/4 objectives).
 */
export const authBackupRetiredScenario: SimulationScenario = {
  id: 'demo-auth-backup-retired',
  origin: 'demo',
  version: 1,
  title: 'Sign-in outage after backup identity provider retirement',
  summary:
    'The primary identity provider has a regional outage. Last month the team retired the ' +
    'LegacyAuth backup provider, but the sign-in recovery runbook still points to it.',
  changeContext: {
    id: 'demo-change-101',
    origin: 'demo',
    key: 'DEMO-CHG-101',
    summary: 'Retire LegacyAuth backup SSO tenant; NimbusID becomes secondary IdP',
    status: 'Done',
    issueType: 'Change',
    updatedAt: '2026-10-31T16:00:00.000Z',
    affectedServiceIds: ['demo-svc-signin'],
  },
  procedure: {
    id: 'demo-rb-auth-01',
    origin: 'demo',
    title: 'RB-AUTH-01 Customer sign-in recovery',
    serviceId: 'demo-svc-signin',
    lastReviewedAt: '2026-03-14T00:00:00.000Z',
    steps: [
      {
        order: 1,
        instruction: 'Confirm elevated sign-in failures on the auth dashboard.',
        dependsOn: [],
      },
      { order: 2, instruction: 'Check the primary IdP status page.', dependsOn: ['primary-idp'] },
      {
        order: 3,
        instruction:
          'If the primary IdP is unavailable for more than 5 minutes, run `authctl failover --target legacyauth`.',
        dependsOn: ['legacyauth'],
      },
      { order: 4, instruction: 'Post a status update to customers.', dependsOn: [] },
    ],
  },
  services: [
    {
      id: 'demo-svc-signin',
      origin: 'demo',
      name: 'Customer Sign-in',
      tier: 'critical',
      ownerTeam: 'Identity Platform',
      dependsOn: ['primary-idp', 'nimbusid'],
      recoveryProcedureIds: ['demo-rb-auth-01'],
    },
  ],
  evidence: [
    {
      id: 'ev-change',
      origin: 'demo',
      kind: 'jira-issue',
      title: 'DEMO-CHG-101 implementation notes',
      excerpt:
        'LegacyAuth tenant decommissioned on 2026-10-31. NimbusID configured as secondary identity ' +
        'provider; fail over via Admin console > Identity > Promote secondary.',
    },
    {
      id: 'ev-runbook-step3',
      origin: 'demo',
      kind: 'runbook-step',
      title: 'RB-AUTH-01 step 3',
      excerpt:
        'If the primary IdP is unavailable for more than 5 minutes, run `authctl failover --target legacyauth`.',
    },
    {
      id: 'ev-runbook-review',
      origin: 'demo',
      kind: 'runbook-step',
      title: 'RB-AUTH-01 review history',
      excerpt: 'Last reviewed 2026-03-14, before DEMO-CHG-101 was completed.',
    },
    {
      id: 'ev-service',
      origin: 'demo',
      kind: 'jsm-service',
      title: 'Customer Sign-in service record',
      excerpt: 'Tier: critical. Depends on: Primary IdP, NimbusID (secondary).',
    },
    {
      id: 'ev-rule-bypass',
      origin: 'demo',
      kind: 'scenario-rule',
      title: 'Scenario rule: SSO enforcement',
      excerpt:
        'Disabling SSO enforcement requires security approval and weakens account protection.',
    },
    {
      id: 'ev-rule-primary',
      origin: 'demo',
      kind: 'scenario-rule',
      title: 'Scenario rule: primary IdP outage duration',
      excerpt: 'In this exercise the primary IdP regional outage lasts 35 minutes.',
    },
  ],
  objectives: [
    {
      id: 'obj-restore',
      label: 'Restore customer sign-in within 30 minutes',
      rule: { kind: 'flagSetWithin', flag: 'loginRestored', minutes: 30 },
    },
    {
      id: 'obj-notify',
      label: 'Notify stakeholders within 15 minutes',
      rule: { kind: 'flagSetWithin', flag: 'stakeholdersNotified', minutes: 15 },
    },
    {
      id: 'obj-gap',
      label: 'Identify the recovery gap introduced by the change',
      rule: { kind: 'flagSet', flag: 'runbookGapIdentified' },
    },
    {
      id: 'obj-security',
      label: 'Keep SSO protections in place',
      rule: { kind: 'flagNeverSet', flag: 'securityBypassed' },
    },
  ],
  startStepId: 'detect',
  steps: {
    detect: {
      id: 'detect',
      title: 'Sign-in failures spike',
      situation:
        '62% of customer sign-in attempts are failing. The primary IdP status page reports a regional ' +
        'outage. You are the incident commander. What do you do first?',
      decisions: [
        {
          id: 'follow-runbook',
          label: 'Follow RB-AUTH-01 step 3: fail over to LegacyAuth',
          detail: 'Run `authctl failover --target legacyauth` as the runbook instructs.',
          consequence: {
            minutes: 10,
            narrative:
              'The failover command times out after several retries. The LegacyAuth tenant no longer ' +
              'exists — it was decommissioned by DEMO-CHG-101, but the runbook was never updated.',
            evidenceIds: ['ev-runbook-step3', 'ev-change'],
            assessment: 'harmful',
          },
          next: 'failover-failed',
        },
        {
          id: 'check-changes',
          label: 'Check recent changes to sign-in dependencies',
          detail: 'Look for changes to identity providers before executing the runbook.',
          consequence: {
            minutes: 5,
            setFlags: ['runbookGapIdentified'],
            narrative:
              'You find DEMO-CHG-101: LegacyAuth was retired and NimbusID is now the secondary IdP. ' +
              'Runbook step 3 is out of date.',
            evidenceIds: ['ev-change', 'ev-runbook-review'],
            assessment: 'effective',
          },
          next: 'communicate',
        },
        {
          id: 'bypass-sso',
          label: 'Disable SSO enforcement and allow password sign-in',
          detail: 'Temporarily let customers sign in with local passwords.',
          consequence: {
            minutes: 4,
            setFlags: ['securityBypassed'],
            narrative:
              'Only customers with a local password can sign in, and account protection is weakened ' +
              'without security approval. Most customers remain locked out.',
            evidenceIds: ['ev-rule-bypass'],
            assessment: 'harmful',
          },
          next: 'communicate',
        },
      ],
    },
    'failover-failed': {
      id: 'failover-failed',
      title: 'Failover did not work',
      situation:
        'The documented failover target is unreachable and sign-in is still failing. What is your next move?',
      decisions: [
        {
          id: 'retry-failover',
          label: 'Retry the LegacyAuth failover',
          consequence: {
            minutes: 10,
            narrative: 'The retry fails the same way. The target tenant does not exist.',
            evidenceIds: ['ev-change'],
            assessment: 'harmful',
          },
          next: 'communicate',
        },
        {
          id: 'inspect-change',
          label: 'Check the change history for the backup provider',
          consequence: {
            minutes: 5,
            setFlags: ['runbookGapIdentified'],
            narrative:
              'DEMO-CHG-101 shows LegacyAuth was retired and NimbusID replaced it. The runbook is stale.',
            evidenceIds: ['ev-change', 'ev-runbook-review'],
            assessment: 'effective',
          },
          next: 'communicate',
        },
        {
          id: 'escalate-vendor',
          label: 'Open a P1 with the LegacyAuth vendor',
          consequence: {
            minutes: 15,
            setFlags: ['runbookGapIdentified'],
            narrative:
              'After 15 minutes the vendor confirms your tenant was decommissioned at your request on ' +
              '2026-10-31. You learn about the gap, but late.',
            evidenceIds: ['ev-change'],
            assessment: 'neutral',
          },
          next: 'communicate',
        },
      ],
    },
    communicate: {
      id: 'communicate',
      title: 'Stakeholder communication',
      situation:
        'Support is receiving tickets about failed sign-ins. How do you handle communication?',
      decisions: [
        {
          id: 'notify-now',
          label: 'Post a status update and brief the support lead now',
          consequence: {
            minutes: 3,
            setFlags: ['stakeholdersNotified'],
            narrative:
              'Customers and support know an incident is in progress and recovery is under way.',
            evidenceIds: ['ev-service'],
            assessment: 'effective',
          },
          next: 'recover-uninformed',
          nextIfFlag: { flag: 'runbookGapIdentified', next: 'recover' },
        },
        {
          id: 'defer-comms',
          label: 'Hold communication until the cause is confirmed',
          consequence: {
            minutes: 0,
            narrative: 'No update is sent. Support keeps escalating tickets without guidance.',
            evidenceIds: ['ev-service'],
            assessment: 'harmful',
          },
          next: 'recover-uninformed',
          nextIfFlag: { flag: 'runbookGapIdentified', next: 'recover' },
        },
      ],
    },
    recover: {
      id: 'recover',
      title: 'Restore sign-in',
      situation:
        'You know LegacyAuth is gone and NimbusID is configured as the secondary IdP. How do you restore sign-in?',
      decisions: [
        {
          id: 'activate-nimbus',
          label: 'Promote NimbusID as the active identity provider',
          detail: 'Admin console > Identity > Promote secondary, as recorded in DEMO-CHG-101.',
          consequence: {
            minutes: 8,
            setFlags: ['loginRestored'],
            narrative: 'NimbusID takes over and sign-in success returns to normal.',
            evidenceIds: ['ev-change', 'ev-service'],
            assessment: 'effective',
          },
          next: null,
        },
        {
          id: 'wait-primary',
          label: 'Wait for the primary IdP to recover',
          consequence: {
            minutes: 35,
            setFlags: ['loginRestored'],
            narrative: 'The primary IdP recovers after 35 minutes and sign-in returns to normal.',
            evidenceIds: ['ev-rule-primary'],
            assessment: 'neutral',
          },
          next: null,
        },
        {
          id: 'emergency-bypass',
          label: 'Enable the emergency local-password bypass',
          consequence: {
            minutes: 4,
            setFlags: ['securityBypassed', 'loginRestored'],
            narrative:
              'Sign-in works for customers with local passwords, but SSO protections are disabled without approval.',
            evidenceIds: ['ev-rule-bypass'],
            assessment: 'harmful',
          },
          next: null,
        },
      ],
    },
    'recover-uninformed': {
      id: 'recover-uninformed',
      title: 'Restore sign-in',
      situation:
        'Sign-in is still failing and the documented failover target does not respond. How do you restore sign-in?',
      decisions: [
        {
          id: 'investigate-failover',
          label: 'Investigate why the documented failover fails',
          consequence: {
            minutes: 6,
            setFlags: ['runbookGapIdentified'],
            narrative:
              'You find DEMO-CHG-101: LegacyAuth was retired and NimbusID is the replacement secondary IdP.',
            evidenceIds: ['ev-change', 'ev-runbook-step3'],
            assessment: 'effective',
          },
          next: 'recover',
        },
        {
          id: 'wait-primary-uninformed',
          label: 'Wait for the primary IdP to recover',
          consequence: {
            minutes: 35,
            setFlags: ['loginRestored'],
            narrative: 'The primary IdP recovers after 35 minutes and sign-in returns to normal.',
            evidenceIds: ['ev-rule-primary'],
            assessment: 'neutral',
          },
          next: null,
        },
        {
          id: 'emergency-bypass-uninformed',
          label: 'Enable the emergency local-password bypass',
          consequence: {
            minutes: 4,
            setFlags: ['securityBypassed', 'loginRestored'],
            narrative:
              'Sign-in works for customers with local passwords, but SSO protections are disabled without approval.',
            evidenceIds: ['ev-rule-bypass'],
            assessment: 'harmful',
          },
          next: null,
        },
      ],
    },
  },
  remediation: [
    {
      id: 'rem-runbook',
      origin: 'demo',
      title: 'Update RB-AUTH-01 step 3 to promote NimbusID',
      description: 'Replace the LegacyAuth failover command with the NimbusID promotion procedure.',
      status: 'proposed',
      evidenceIds: ['ev-runbook-step3', 'ev-change'],
    },
    {
      id: 'rem-change-checklist',
      origin: 'demo',
      title: 'Add a recovery-procedure check to identity provider changes',
      description:
        'Changes that retire an identity provider must list and update affected runbooks.',
      status: 'proposed',
      evidenceIds: ['ev-runbook-review'],
    },
  ],
};
