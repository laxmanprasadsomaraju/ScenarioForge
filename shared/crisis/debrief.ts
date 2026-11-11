import type { EvidenceReference } from '../domain/types';
import { decisionTrail, evaluateSession } from '../simulation/engine';
import { createAuditRecord } from '../simulation/replay';
import type { RunSubmission } from '../history/types';
import { CrisisLogError, rebuildRoom } from './room';
import type {
  CrisisAfterActionReport,
  CrisisDebrief,
  CrisisEvent,
  CrisisRole,
  ParticipantAlias,
  RoleContribution,
  TimelineEntry,
} from './types';

/**
 * Collaborative debrief and after-action report, derived only from the event
 * log. Nothing here is typed in by participants after the fact.
 */

/** Server-only: the report stored in the owner's own history keeps real ids. */
export const identityAlias: ParticipantAlias = (accountId) => accountId;

export function buildDebrief(
  events: readonly CrisisEvent[],
  alias: ParticipantAlias,
): CrisisDebrief {
  const state = rebuildRoom(events);
  if (!state.session || state.session.status !== 'completed') {
    throw new CrisisLogError('The debrief needs a completed session.');
  }
  const evaluation = evaluateSession(state.scenario, state.session);
  const trail = decisionTrail(state.scenario, state.session);

  // Walk the log once more to attribute each event to the role held at that moment.
  const roles = new Map<string, CrisisRole>();
  const history = new Map<string, CrisisRole[]>();
  type Internal = Omit<RoleContribution, 'participantId'> & { accountId: string };
  const contributions = new Map<string, Internal>();
  const contribution = (id: string) => {
    let c = contributions.get(id);
    if (!c) {
      c = {
        accountId: id,
        roles: [],
        proposals: 0,
        proposalsAdopted: 0,
        decisionsCommitted: 0,
        statusUpdates: 0,
        stakeholderNotices: 0,
      };
      contributions.set(id, c);
    }
    return c;
  };
  const setRole = (id: string, role: CrisisRole) => {
    roles.set(id, role);
    const h = history.get(id) ?? [];
    if (h[h.length - 1] !== role) h.push(role);
    history.set(id, h);
    contribution(id);
  };
  const proposer = new Map<string, string>();
  let minute: number | null = null;
  let decisionIndex = 0;

  const timeline: TimelineEntry[] = [];
  for (const e of events) {
    let summary: string;
    switch (e.type) {
      case 'room-created':
        setRole(e.actor, 'incident-commander');
        summary = `Room created for “${e.scenario.title}”.`;
        break;
      case 'invite-issued':
        summary = `Invite issued for role ${e.role}.`;
        break;
      case 'invite-revoked':
        summary = 'Invite revoked.';
        break;
      case 'participant-joined':
        setRole(e.actor, e.role);
        summary = `Joined as ${e.role}.`;
        break;
      case 'participant-left':
        summary = 'Left the room.';
        break;
      case 'role-assigned':
        setRole(e.accountId, e.role);
        summary = `A participant is now ${e.role}.`;
        break;
      case 'command-handed-off': {
        const from = [...roles].find(([, r]) => r === 'incident-commander')?.[0];
        const incoming = roles.get(e.to)!;
        if (from) setRole(from, incoming);
        setRole(e.to, 'incident-commander');
        summary = 'Command handed to another participant.';
        break;
      }
      case 'session-started':
        minute = 0;
        summary = 'Exercise started.';
        break;
      case 'proposal-made':
        contribution(e.actor).proposals++;
        proposer.set(e.proposalId, e.actor);
        summary = `Proposed ${e.decisionId} at ${e.stepId}.`;
        break;
      case 'decision-committed': {
        contribution(e.actor).decisionsCommitted++;
        if (e.proposalId) contribution(proposer.get(e.proposalId)!).proposalsAdopted++;
        const t = trail[decisionIndex++]!;
        summary = `Committed “${t.decision.label}” (${t.decision.consequence.assessment}).`;
        break;
      }
      case 'communication-posted':
        if (e.kind === 'status-update') contribution(e.actor).statusUpdates++;
        else contribution(e.actor).stakeholderNotices++;
        summary = `${e.kind === 'status-update' ? 'Status update' : 'Stakeholder notice'}: ${e.text}`;
        break;
      case 'room-closed':
        summary = 'Room closed.';
        break;
    }
    // A decision is stamped when it was made; the clock then advances by its consequence.
    let atMinute = minute;
    if (e.type === 'decision-committed') {
      const t = trail[decisionIndex - 1]!;
      atMinute = t.record.atMinute;
      minute = t.record.atMinute + t.decision.consequence.minutes;
    }
    timeline.push({
      seq: e.seq,
      at: e.at,
      actor: alias(e.actor),
      role: roles.get(e.actor) ?? null,
      type: e.type,
      atMinute,
      summary,
    });
  }

  const byId = new Map(state.scenario.evidence.map((x) => [x.id, x]));
  const evidence: EvidenceReference[] = [];
  const seen = new Set<string>();
  for (const t of trail) {
    for (const id of t.decision.consequence.evidenceIds) {
      if (!seen.has(id) && byId.has(id)) {
        seen.add(id);
        evidence.push(byId.get(id)!);
      }
    }
  }

  return {
    roomId: state.roomId,
    scenarioId: state.scenario.id,
    scenarioFingerprint: state.scenarioFingerprint,
    evaluation,
    contributions: [...contributions.values()].map(({ accountId, ...c }) => ({
      ...c,
      participantId: alias(accountId),
      roles: history.get(accountId) ?? [],
    })),
    timeline,
    evidence,
    decisions: state.decisions.map((d, i) => ({
      ...d,
      actor: alias(d.actor),
      label: trail[i]!.decision.label,
      assessment: trail[i]!.decision.consequence.assessment,
      narrative: trail[i]!.decision.consequence.narrative,
    })),
  };
}

/**
 * After-action report. `audit` is a shared/simulation audit record and
 * `submission` a shared/history RunSubmission with session id = room id, so
 * the existing saveRun path re-verifies and stores the team run unchanged.
 */
export function buildAfterActionReport(events: readonly CrisisEvent[]): CrisisAfterActionReport {
  const state = rebuildRoom(events);
  const debrief = buildDebrief(events, identityAlias);
  const session = state.session!;
  const audit = createAuditRecord(state.scenario, session);
  const submission: RunSubmission = {
    sessionId: session.id,
    startedAt: session.startedAt,
    decisionIds: session.decisions.map((d) => d.decisionId),
    scenarioFingerprint: state.scenarioFingerprint,
    evaluation: debrief.evaluation,
    flags: { ...session.flags },
  };
  return {
    kind: 'crisis-after-action',
    schemaVersion: 1,
    roomId: state.roomId,
    owner: state.owner,
    audit,
    submission,
    debrief,
  };
}
