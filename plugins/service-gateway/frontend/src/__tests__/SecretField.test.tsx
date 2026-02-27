import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SecretField } from '../components/SecretField';

describe('SecretField', () => {
  it('renders input in editing mode by default', () => {
    render(<SecretField label="Token" name="token" onChange={() => {}} />);
    expect(screen.getByLabelText('Token')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('••••••••')).toBeInTheDocument();
  });

  it('calls onChange with name and value on input', () => {
    const onChange = vi.fn();
    render(<SecretField label="Token" name="token" onChange={onChange} />);
    fireEvent.change(screen.getByPlaceholderText('••••••••'), { target: { value: 'abc123' } });
    expect(onChange).toHaveBeenCalledWith('token', 'abc123');
  });

  it('shows saved indicator and masks value when saved=true', () => {
    render(<SecretField label="API Key" name="key" saved onChange={() => {}} />);
    expect(screen.getByText('Saved')).toBeInTheDocument();
    expect(screen.getByText('Update')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('••••••••')).not.toBeInTheDocument();
  });

  it('switches to editing mode when Update is clicked', () => {
    render(<SecretField label="API Key" name="key" saved onChange={() => {}} />);
    fireEvent.click(screen.getByText('Update'));
    expect(screen.getByPlaceholderText('••••••••')).toBeInTheDocument();
  });

  it('uses type=password for the input', () => {
    render(<SecretField label="Password" name="pw" onChange={() => {}} />);
    expect(screen.getByPlaceholderText('••••••••')).toHaveAttribute('type', 'password');
  });
});
