import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AttentionPanel } from '../AttentionPanel';

describe('AttentionPanel', () => {
  it('shows All clear when empty', () => {
    render(<AttentionPanel items={[]} summary={null} />);
    expect(screen.getByText(/All clear/)).toBeInTheDocument();
  });

  it('renders summary above items when present', () => {
    render(<AttentionPanel items={[
      { id: '1', severity: 'critical', title: 'Acme · 32 days overdue', amountCents: 450000 },
    ]} summary={{ summary: 'Test summary line', generatedAt: '', source: 'llm' }} />);
    expect(screen.getByText('Test summary line')).toBeInTheDocument();
    expect(screen.getByText(/Acme/)).toBeInTheDocument();
  });
});
