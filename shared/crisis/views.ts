import type { EvidenceReference } from '../domain/types';
import { currentStep, objectiveProgress } from '../simulation/engine';
import { PROPOSER_ROLES } from './room';
import type { CommunicationKind, CrisisRole, CrisisRoomState, RoleView } from './types';

/**
 * Role-scoped views. The server builds one per caller; the browser never
 * receives the full room (invite hashes, other roles' evidence).
 *
 * Evidence scoping is about focus, not secrecy from teammates: every role can
 * see the situation, objectives, timeline and communications. Only the
 * commander sees all evidence, because only the commander commits.
 */
export const ROLE_EVIDENCE: Record<CrisisRole, readonly EvidenceReference['kind'][]> = {
  'incident-commander': [
    'jira-issue',
    'confluence-page',
    'jsm-service',
    'teamwork-graph',
    'runbook-step',
    'scenario-rule',
  ],
  'engineering-responder': [
    'jira-issue',
    'runbook-step',
    'jsm-service',
    'teamwork-graph',
    'scenario-rule',
  ],
  'security-responder': ['jira-issue', 'confluence-page', 'runbook-step', 'scenario-rule'],
  'communications-lead': ['jsm-service', 'scenario-rule'],
  observer: [],
};

export type ViewResult = { ok: true; view: RoleView } | { ok: false; reason: 'NOT_PARTICIPANT' };

export function roleView(state: CrisisRoomState, viewer: string): ViewResult {
  const me = state.participants.find((p) => p.accountId === viewer && p.active);
  if (!me) return { ok: false, reason: 'NOT_PARTICIPANT' };
  const { role } = me;
  const running = state.status === 'running';
  const step = state.session ? currentStep(state.scenario, state.session) : null;
  const isCommander = viewer === state.commander;
  const canPropose = running && PROPOSER_ROLES.includes(role);
  const canCommit = running && isCommander;
  const kinds = new Set(ROLE_EVIDENCE[role]);

  const communicate: CommunicationKind[] = [];
  if (role !== 'observer' && (running || state.status === 'debrief'))
    communicate.push('status-update');
  if (running && (role === 'incident-commander' || role === 'communications-lead')) {
    communicate.push('stakeholder-notice');
  }

  return {
    ok: true,
    view: {
      roomId: state.roomId,
      version: state.version,
      status: state.status,
      viewer,
      role,
      commander: state.commander,
      participants: state.participants.map(({ accountId, role: r, active }) => ({
        accountId,
        role: r,
        active,
      })),
      step: step ? { id: step.id, title: step.title, situation: step.situation } : null,
      options:
        step && (canPropose || canCommit)
          ? step.decisions.map((d) => ({
              id: d.id,
              label: d.label,
              ...(d.detail ? { detail: d.detail } : {}),
            }))
          : [],
      evidence: state.scenario.evidence.filter((e) => kinds.has(e.kind)),
      objectives: state.scenario.objectives.map((o) => ({
        objectiveId: o.id,
        label: o.label,
        progress: state.session ? objectiveProgress(o, state.session) : 'pending',
      })),
      elapsedMinutes: state.session?.elapsedMinutes ?? 0,
      openProposals: state.proposals
        .filter((p) => p.status === 'open')
        .map(({ status: _status, ...rest }) => rest),
      decisions: state.decisions,
      communications: state.communications,
      can: {
        propose: canPropose,
        commit: canCommit,
        communicate,
        manage: viewer === state.owner && state.status !== 'closed',
      },
    },
  };
}
