export interface Plan {
  id: string;
  code: string;
  name: string;
  description: string | null;
  priceCents: number;
  currency: string;
  interval: 'month' | 'year';
  features: { telegram_bot: boolean; tax_package_generation: boolean; multi_user_teams: boolean };
  quotas: {
    expenses_created: number;
    ocr_scans: number;
    ai_messages: number;
    invoices_sent: number;
    bank_connections: number;
  };
  isActive: boolean;
  sortOrder: number;
}

export type PlanTemplate = Omit<Plan, 'id' | 'isActive' | 'sortOrder'>;

async function json<T>(r: Response): Promise<T> {
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return (await r.json()) as T;
}

export const billingApi = {
  listPlans: async (): Promise<Plan[]> =>
    (await json<{ plans: Plan[] }>(await fetch('/api/v1/agentbook-billing/plans'))).plans,
  listTemplates: async (): Promise<PlanTemplate[]> =>
    (await json<{ templates: PlanTemplate[] }>(await fetch('/api/v1/agentbook-billing/templates'))).templates,
  createPlan: async (body: PlanTemplate & { code: string }): Promise<Plan> =>
    (await json<{ plan: Plan }>(await fetch('/api/v1/agentbook-billing/plans', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    }))).plan,
  patchPlan: async (id: string, patch: Partial<Plan>): Promise<Plan> =>
    (await json<{ plan: Plan }>(await fetch(`/api/v1/agentbook-billing/plans/${id}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch),
    }))).plan,
  archivePlan: async (id: string): Promise<void> => {
    await json<unknown>(await fetch(`/api/v1/agentbook-billing/plans/${id}`, { method: 'DELETE' }));
  },
};

export interface CurrentPlanView {
  plan: Plan;
  status: 'active' | 'trialing' | 'past_due' | 'canceled' | 'incomplete';
  periodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  usage: Record<string, { used: number; limit: number }>;
}

export const meApi = {
  current: async (): Promise<CurrentPlanView> =>
    json<CurrentPlanView>(await fetch('/api/v1/agentbook-billing/me/subscription')),
  intent: async (): Promise<{ clientSecret: string; customerId: string }> =>
    json(await fetch('/api/v1/agentbook-billing/me/subscription/intent', { method: 'POST' })),
  subscribe: async (planId: string, paymentMethodId: string): Promise<void> => {
    await json<unknown>(await fetch('/api/v1/agentbook-billing/me/subscription', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ planId, paymentMethodId }),
    }));
  },
  cancel: async (): Promise<void> => {
    await json<unknown>(await fetch('/api/v1/agentbook-billing/me/subscription/cancel', { method: 'POST' }));
  },
  reactivate: async (): Promise<void> => {
    await json<unknown>(await fetch('/api/v1/agentbook-billing/me/subscription/reactivate', { method: 'POST' }));
  },
};
