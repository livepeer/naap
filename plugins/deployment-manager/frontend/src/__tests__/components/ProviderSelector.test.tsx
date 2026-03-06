import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ProviderSelector } from '../../components/ProviderSelector';

const mockProviders = [
  { slug: 'fal-ai', displayName: 'fal.ai GPU', description: 'Serverless GPU', icon: '⚡', mode: 'serverless' as const, authMethod: 'api-key', secretNames: ['api-key'] },
  { slug: 'ssh-bridge', displayName: 'SSH Bridge', description: 'Bare Metal', icon: '🖥', mode: 'ssh-bridge' as const, authMethod: 'ssh-key', secretNames: [] },
];

describe('ProviderSelector', () => {
  it('should render all providers', () => {
    render(<ProviderSelector providers={mockProviders} selected={null} onSelect={() => {}} />);
    expect(screen.getByText('fal.ai GPU')).toBeInTheDocument();
    expect(screen.getAllByText('SSH Bridge').length).toBeGreaterThanOrEqual(1);
  });

  it('should call onSelect when provider clicked', () => {
    const onSelect = vi.fn();
    render(<ProviderSelector providers={mockProviders} selected={null} onSelect={onSelect} />);
    fireEvent.click(screen.getByText('fal.ai GPU'));
    expect(onSelect).toHaveBeenCalledWith('fal-ai');
  });

  it('should display provider descriptions', () => {
    render(<ProviderSelector providers={mockProviders} selected={null} onSelect={() => {}} />);
    expect(screen.getByText('Serverless GPU')).toBeInTheDocument();
    expect(screen.getByText('Bare Metal')).toBeInTheDocument();
  });

  it('should render mode badges', () => {
    render(<ProviderSelector providers={mockProviders} selected={null} onSelect={() => {}} />);
    expect(screen.getByText('Serverless')).toBeInTheDocument();
    expect(screen.getByText('api-key')).toBeInTheDocument();
    expect(screen.getByText('ssh-key')).toBeInTheDocument();
  });

  it('should handle empty provider list', () => {
    const { container } = render(<ProviderSelector providers={[]} selected={null} onSelect={() => {}} />);
    expect(container.querySelectorAll('button')).toHaveLength(0);
  });
});
