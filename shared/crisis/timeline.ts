import { decisionTrail } from '../simulation/engine';
import { rebuildRoom } from './room';
import type { CrisisEvent, CrisisRole, TimelineEntry } from './types';

/**
 * The shared timeline while a room is open (lobby, running or after).
 * `buildDebrief` has a timeline too, but only for a completed session; this
 * one works at any version so every participant sees the same history as the
 * room runs.
 *
 * Summaries name roles, never account ids, and leave out invite details
 * (an invite is reported by role only).
 */
export const ROLE_NAME: Record<CrisisRole, string> = {
  'incident-commander': 'Incident commander',
  'engineering-responder': 'Engineering responder',
  'security-responder': 'Security responder',
  'communications-lead': 'Communications lead',
  observer: 'Observer',
};

export function buildTimeline(events: readonly CrisisEvent[]): TimelineEntry[] {
  const state = rebuildRoom(events);
  const trail = state.session ? decisionTrail(state.scenario, state.session) : [];
  const roles = new Map<string, CrisisRole>();
  const labels = new Map<string, string>();
  for (const step of Object.values(state.scenario.steps)) {
    for (const d of step.decisions) labels.set(`${step.id}/${d.id}`, d.label);
  }
  let minute: number | null = null;
  let decisionIndex = 0;
  const out: TimelineEntry[] = [];

  for (const e of events) {
    let summary: string;
    let atMinute = minute;
    switch (e.type) {
      case 'room-created':
        roles.set(e.actor, 'incident-commander');
        summary = `Room opened for “${e.scenario.title}”.`;
        break;
      case 'invite-issued':
        summary = `Invite issued for ${ROLE_NAME[e.role]}.`;
        break;
      case 'invite-revoked':
        summary = 'An invite was revoked.';
        break;
      case 'participant-joined':
        roles.set(e.actor, e.role);
        summary = `${ROLE_NAME[e.role]} joined.`;
        break;
      case 'participant-left':
        summary = `${ROLE_NAME[roles.get(e.actor) ?? 'observer']} left.`;
        break;
      case 'role-assigned':
        roles.set(e.accountId, e.role);
        summary = `A participant is now ${ROLE_NAME[e.role]}.`;
        break;
      case 'command-handed-off': {
        const from = [...roles].find(([, r]) => r === 'incident-commander')?.[0];
        const incoming = roles.get(e.to) ?? 'observer';
        if (from) roles.set(from, incoming);
        roles.set(e.to, 'incident-commander');
        summary = `Command handed off; the outgoing commander is now ${ROLE_NAME[incoming]}.`;
        break;
      }
      case 'session-started':
        minute = 0;
        atMinute = 0;
        summary = 'Exercise started.';
        break;
      case 'proposal-made':
        summary = `Proposed “${labels.get(`${e.stepId}/${e.decisionId}`) ?? e.decisionId}”.`;
        break;
      case 'decision-committed': {
        const t = trail[decisionIndex++];
        if (t) {
          atMinute = t.record.atMinute;
          minute = t.record.atMinute + t.decision.consequence.minutes;
          summary = `Committed “${t.decision.label}”${e.proposalId ? ' (adopted proposal)' : ''}.`;
        } else {
          summary = 'Decision committed.';
        }
        break;
      }
      case 'communication-posted':
        summary = `${e.kind === 'status-update' ? 'Status update' : 'Stakeholder notice'}: ${e.text}`;
        break;
      case 'room-closed':
        summary = 'Room closed.';
        break;
    }
    out.push({
      seq: e.seq,
      at: e.at,
      actor: e.actor,
      role: roles.get(e.actor) ?? null,
      type: e.type,
      atMinute,
      summary,
    });
  }
  return out;
}
