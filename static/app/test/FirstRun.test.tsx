import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HOW_IT_WORKS_KEY, HowItWorks } from '../src/components/command/HowItWorks';

beforeEach(() => window.localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('How ScenarioForge works', () => {
  it('explains the five steps and points at the synthetic demo, without a tour', () => {
    render(<HowItWorks checked={false} />);
    expect(screen.getByRole('heading', { name: 'How ScenarioForge works' })).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(5);
    expect(screen.getByText(/try the synthetic demo first/)).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('hides on request and stays hidden after a reload', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<HowItWorks checked={false} />);
    await user.click(screen.getByRole('button', { name: 'Hide this' }));
    expect(screen.queryByRole('heading', { name: 'How ScenarioForge works' })).toBeNull();
    expect(window.localStorage.getItem(HOW_IT_WORKS_KEY)).toBe('dismissed');
    unmount();
    render(<HowItWorks checked={false} />);
    expect(screen.queryByRole('heading', { name: 'How ScenarioForge works' })).toBeNull();
  });

  it('works when storage throws', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const user = userEvent.setup();
    render(<HowItWorks checked />);
    expect(screen.getByText(/You have started/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Hide this' }));
    expect(screen.queryByRole('heading', { name: 'How ScenarioForge works' })).toBeNull();
  });
});
