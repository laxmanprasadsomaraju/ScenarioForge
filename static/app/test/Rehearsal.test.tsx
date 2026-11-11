import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { authBackupRetiredScenario as DEMO } from '@shared/simulation/scenarios/authBackupRetired';
import { SimulationsPage } from '../src/pages/Simulations';
import { Briefing } from '../src/components/simulation/Briefing';
import { renderInApp } from './helpers';

vi.mock('../src/lib/api', () => ({
  api: { getConnectionStatus: vi.fn(), listRecentChanges: vi.fn() },
}));

type User = ReturnType<typeof userEvent.setup>;

const quote = (id: string) => DEMO.evidence.find((e) => e.id === id)!.excerpt!;
const narratives = Object.values(DEMO.steps).flatMap((s) =>
  s.decisions.map((d) => d.consequence.narrative),
);

async function choose(user: User, label: string) {
  const options = within(screen.getByRole('list', { name: 'Your options' }));
  await user.click(options.getByRole('button', { name: new RegExp(`^${label}`) }));
}

function clock() {
  return document.querySelector('.clock-value')?.textContent;
}

/** Makes the stacked (phone) layout query match. */
function mockStacked() {
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) =>
      ({
        matches: query === '(max-width: 60rem)',
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList,
  );
}

afterEach(() => vi.restoreAllMocks());

describe('Mission briefing', () => {
  it('lays out the scenario, source, quotes, role, target, objectives and rules', () => {
    renderInApp(<SimulationsPage />);
    const briefing = within(screen.getByRole('region', { name: DEMO.title }));
    expect(briefing.getByText(DEMO.summary)).toBeInTheDocument();
    expect(briefing.getByText(DEMO.changeContext.key)).toBeInTheDocument();
    // Quotes are verbatim, never paraphrased.
    expect(briefing.getByText(quote('ev-change'))).toBeInTheDocument();
    expect(briefing.getByText(quote('ev-runbook-step3'))).toBeInTheDocument();
    expect(briefing.getByText('Synthetic scenario')).toBeInTheDocument();
    expect(briefing.getByText(/^Incident commander/)).toBeInTheDocument();
    expect(briefing.getByText(/Restore customer sign-in within 30 minutes/)).toHaveTextContent(
      '(by T+30 min)',
    );
    expect(briefing.getByText(/Outcomes are modelled by fixed scenario rules/)).toBeInTheDocument();
    expect(briefing.getByRole('button', { name: 'Start rehearsal' })).toBeInTheDocument();

    const material = within(screen.getByRole('complementary', { name: 'Briefing material' }));
    for (const o of DEMO.objectives) expect(material.getByText(o.label)).toBeInTheDocument();
    expect(material.getByRole('link', { name: 'Crisis room' })).toHaveAttribute(
      'href',
      '/crisis-room',
    );
    expect(material.getByText(/coming later/)).toBeInTheDocument();
  });

  it('states the finding confidence for a rehearsal built from a real change', () => {
    renderInApp(
      <Briefing
        scenario={DEMO}
        provenance={{
          changeKey: 'MC-62',
          findingId: 'f1',
          confidence: 'suspected',
          consequencesModelled: true,
        }}
        onStart={() => {}}
      />,
    );
    expect(screen.getByText('Suspected finding, not yet confirmed')).toBeInTheDocument();
  });
});

describe('Incident command', () => {
  it('reveals no consequence before a choice is made', async () => {
    const user = userEvent.setup();
    renderInApp(<SimulationsPage />);
    await user.click(screen.getByRole('button', { name: 'Start rehearsal' }));

    expect(screen.getByRole('status')).toBeEmptyDOMElement();
    const options = screen.getByRole('list', { name: 'Your options' });
    for (const word of ['Effective', 'Slow', 'Costly']) {
      expect(within(options).queryByText(word)).not.toBeInTheDocument();
    }
    for (const text of narratives) expect(screen.queryByText(text)).not.toBeInTheDocument();
    expect(screen.queryByText(/What happened/)).not.toBeInTheDocument();
  });

  it('advances the clock, the timeline and objectives after a decision', async () => {
    const user = userEvent.setup();
    renderInApp(<SimulationsPage />);
    await user.click(screen.getByRole('button', { name: 'Start rehearsal' }));
    expect(clock()).toBe('T+0 min');

    await choose(user, 'Check recent changes to sign-in dependencies');
    expect(clock()).toBe('T+5 min');

    const status = within(screen.getByRole('status'));
    expect(status.getByText('Effective')).toBeInTheDocument();
    expect(status.getByText(/Took 5 min, clock now T\+5/)).toBeInTheDocument();
    expect(status.getByText('Modelled result')).toBeInTheDocument();
    expect(
      within(status.getByRole('list', { name: 'Objective updates' })).getByText(
        'Identify the recovery gap introduced by the change: Met',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Why, from the evidence' })).toBeInTheDocument();

    const rail = within(screen.getByRole('list', { name: 'Exercise timeline' }));
    expect(rail.getByText('Check recent changes to sign-in dependencies')).toBeInTheDocument();
    expect(rail.getByText('Now: your decision').closest('li')).toHaveTextContent('T+5');

    const objective = screen
      .getByRole('region', { name: 'Objectives' })
      .querySelector('.objective-met');
    expect(objective).toHaveTextContent('Identify the recovery gap');

    // The next situation follows and takes focus.
    expect(document.getElementById('situation-title')).toHaveFocus();
  });

  it('reports a missed objective when a choice breaks it', async () => {
    const user = userEvent.setup();
    renderInApp(<SimulationsPage />);
    await user.click(screen.getByRole('button', { name: 'Start rehearsal' }));
    await choose(user, 'Disable SSO enforcement');
    expect(
      within(screen.getByRole('list', { name: 'Objective updates' })).getByText(
        'Keep SSO protections in place: Missed',
      ),
    ).toBeInTheDocument();
    expect(within(screen.getByRole('status')).getByText('Costly')).toBeInTheDocument();
  });
});

describe('Phone layout', () => {
  it('puts the situation first and side panels in closed, labelled disclosures', async () => {
    mockStacked();
    const user = userEvent.setup();
    renderInApp(<SimulationsPage />);
    await user.click(screen.getByRole('button', { name: 'Start rehearsal' }));

    const situation = document.getElementById('situation-title')!;
    const panels = Array.from(document.querySelectorAll('details.panel-disclosure'));
    expect(panels).toHaveLength(3);
    for (const panel of panels) {
      expect(panel).not.toHaveAttribute('open');
      // The situation and decisions come before every disclosure in reading order.
      expect(
        situation.compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      // A native summary is the first child, so it is keyboard operable and named.
      expect(panel.firstElementChild?.tagName).toBe('SUMMARY');
    }
    expect(screen.getByRole('list', { name: 'Your options' })).toBeVisible();

    const summary = screen.getByText('Objectives').closest('summary')!;
    expect(summary).toHaveTextContent('0 of 4 met');
    await user.click(summary);
    expect(summary.parentElement).toHaveAttribute('open');

    // The simulated clock stays in the bar on a phone too.
    expect(clock()).toBe('T+0 min');
  });
});
