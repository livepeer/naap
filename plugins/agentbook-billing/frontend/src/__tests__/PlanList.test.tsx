import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { PlanList } from '../admin/PlanList';

const mockListPlans = vi.fn();
const mockArchivePlan = vi.fn();
vi.mock('../lib/api', () => ({
  billingApi: {
    listPlans: () => mockListPlans(),
    archivePlan: (id: string) => mockArchivePlan(id),
  },
}));

const proRow = {
  id: 'p1', code: 'pro', name: 'Pro', priceCents: 1900, currency: 'usd', interval: 'month' as const,
  description: '',
  features: { telegram_bot: true, tax_package_generation: true, multi_user_teams: false },
  quotas: { expenses_created: 1000, ocr_scans: 200, ai_messages: 5000, invoices_sent: 200, bank_connections: 3 },
  isActive: true, sortOrder: 0,
};

beforeEach(() => { mockListPlans.mockReset(); mockArchivePlan.mockReset(); });

describe('PlanList', () => {
  it('renders plans with formatted price', async () => {
    mockListPlans.mockResolvedValue([proRow]);
    render(<PlanList onEdit={() => {}} onAdd={() => {}} />);
    await waitFor(() => expect(screen.getByText('Pro')).toBeTruthy());
    expect(screen.getByText('$19.00 / month')).toBeTruthy();
  });

  it('archives a plan on Archive click', async () => {
    mockListPlans.mockResolvedValue([proRow]);
    mockArchivePlan.mockResolvedValue(undefined);
    window.confirm = () => true;
    render(<PlanList onEdit={() => {}} onAdd={() => {}} />);
    await waitFor(() => screen.getByText('Pro'));
    fireEvent.click(screen.getByRole('button', { name: /archive/i }));
    await waitFor(() => expect(mockArchivePlan).toHaveBeenCalledWith('p1'));
  });

  it('calls onEdit when Edit clicked', async () => {
    mockListPlans.mockResolvedValue([proRow]);
    const onEdit = vi.fn();
    render(<PlanList onEdit={onEdit} onAdd={() => {}} />);
    await waitFor(() => screen.getByText('Pro'));
    fireEvent.click(screen.getByRole('button', { name: /edit/i }));
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: 'p1' }));
  });

  it('calls onAdd when "+ New plan from template" clicked', async () => {
    mockListPlans.mockResolvedValue([]);
    const onAdd = vi.fn();
    render(<PlanList onEdit={() => {}} onAdd={onAdd} />);
    await waitFor(() => screen.getByRole('button', { name: /new plan from template/i }));
    fireEvent.click(screen.getByRole('button', { name: /new plan from template/i }));
    expect(onAdd).toHaveBeenCalledOnce();
  });
});
