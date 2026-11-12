// Regression for M6 Test 12: routing of saved rehearsals to explain-outcome. Tool
// selection by Rovo's model cannot be proven offline; this pins the manifest text,
// the prompt rules and the handler messages the agent is told to quote.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { createAgentActions, MESSAGES } from '../src/agents/actions';

const root = join(__dirname, '..');
const manifest = parse(readFileSync(join(root, 'manifest.yml'), 'utf8')) as {
  modules: {
    'rovo:agent': { key: string; actions: string[]; conversationStarters: string[] }[];
    action: {
      key: string;
      description: string;
      inputs: Record<string, { description: string }>;
    }[];
  };
};
const prompt = readFileSync(join(root, 'agents/prompts/facilitator.md'), 'utf8');
const action = (key: string) => manifest.modules.action.find((a) => a.key === key)!;

describe('explain-outcome routing', () => {
  it('assigns explain-outcome to the facilitator with a session-id starter', () => {
    const f = manifest.modules['rovo:agent'].find((a) => a.key === 'exercise-facilitator')!;
    expect(f.actions).toContain('explain-outcome');
    expect(f.conversationStarters.join('\n')).toMatch(/Explain the outcome of rehearsal/);
  });

  it('describes explain-outcome as the only saved-rehearsal action taking the History Session ID', () => {
    const a = action('explain-outcome');
    expect(a.description).toContain('ONLY action for saved rehearsals');
    expect(a.description).toContain('Session ID shown in ScenarioForge History');
    expect(a.description).toContain('UUID');
    expect(a.inputs.sessionId!.description).toContain('ScenarioForge History');
    expect(a.inputs.sessionId!.description).toContain('UUID');
  });

  it('keeps the other actions explicit that they take no session id', () => {
    for (const k of ['find-recovery-risks', 'prepare-rehearsal']) {
      expect(action(k).description).toContain('Takes no session id');
      expect(action(k).description).toContain('explain-outcome');
    }
  });

  it('puts the routing rules in the facilitator prompt', () => {
    expect(prompt).toContain('you MUST call `explain-outcome` with `sessionId` copied exactly');
    expect(prompt).toContain('never call `find-recovery-risks` or `prepare-rehearsal` instead');
    expect(prompt).toContain('repeat the message and stop');
    expect(prompt).toContain('Do not substitute Jira readiness findings');
    expect(prompt).toContain('ask for the Session ID shown in ScenarioForge History');
    expect(prompt.indexOf('## Routing')).toBeLessThan(prompt.indexOf('## Always'));
  });

  it('answers a missing or empty session id with a message asking for it, never findings', () => {
    expect(MESSAGES.sessionId).toContain('Ask the user for it; do not guess');
    expect(MESSAGES.sessionId).toContain('ScenarioForge History');
    expect(MESSAGES.historyUnreachable).toContain('history is unavailable');
    expect(typeof createAgentActions).toBe('function');
  });
});
