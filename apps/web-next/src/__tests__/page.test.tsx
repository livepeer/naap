import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import HomePage from '../app/page';

describe('HomePage', () => {
  it('renders the main heading', () => {
    render(<HomePage />);

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('NaaP Platform');
  });

  it('renders the description', () => {
    render(<HomePage />);

    expect(
      screen.getByText(/Network as a Platform.*Decentralized Infrastructure/i)
    ).toBeInTheDocument();
  });

  it('renders navigation links', () => {
    render(<HomePage />);

    expect(screen.getByRole('link', { name: /Get Started/i })).toHaveAttribute('href', '/login');
    expect(screen.getByRole('link', { name: /Documentation/i })).toHaveAttribute('href', '/docs');
  });

  it('renders feature cards', () => {
    render(<HomePage />);

    expect(screen.getByText('Gateway Management')).toBeInTheDocument();
    expect(screen.getByText('Plugin Ecosystem')).toBeInTheDocument();
    expect(screen.getByText('Vercel-Ready')).toBeInTheDocument();
  });
});
