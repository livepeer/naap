/**
 * Guided Onboarding — Step-by-step setup for new AgentBook users.
 */

export interface OnboardingStep {
  id: string;
  title: string;
  description: string;
  completed: boolean;
  order: number;
}

const ONBOARDING_STEPS: OnboardingStep[] = [
  { id: 'business_type', title: 'Choose your business type', description: 'Freelancer, sole proprietor, or consultant?', completed: false, order: 0 },
  { id: 'jurisdiction', title: 'Set your country & region', description: 'US or Canada? Which state/province?', completed: false, order: 1 },
  { id: 'currency', title: 'Set your currency', description: 'USD or CAD?', completed: false, order: 2 },
  { id: 'accounts', title: 'Set up chart of accounts', description: 'We\'ll create accounts based on your tax jurisdiction', completed: false, order: 3 },
  { id: 'bank', title: 'Connect your bank', description: 'Link via Plaid for automatic transaction import', completed: false, order: 4 },
  { id: 'first_expense', title: 'Record your first expense', description: 'Snap a receipt or type an expense', completed: false, order: 5 },
  { id: 'telegram', title: 'Connect Telegram', description: 'Get proactive notifications and snap receipts on the go', completed: false, order: 6 },
];

export async function getOnboardingProgress(tenantId: string, db: any): Promise<{
  steps: OnboardingStep[];
  currentStep: number;
  percentComplete: number;
  isComplete: boolean;
}> {
  let progress = await db.abOnboardingProgress.findUnique({ where: { tenantId } });
  if (!progress) {
    progress = await db.abOnboardingProgress.create({ data: { tenantId } });
  }

  const completedSet = new Set(progress.completedSteps);
  const steps = ONBOARDING_STEPS.map(s => ({ ...s, completed: completedSet.has(s.id) }));
  const completedCount = steps.filter(s => s.completed).length;

  return {
    steps,
    currentStep: progress.currentStep,
    percentComplete: steps.length > 0 ? completedCount / steps.length : 0,
    isComplete: completedCount === steps.length,
  };
}

export async function completeOnboardingStep(
  tenantId: string,
  stepId: string,
  db: any,
): Promise<void> {
  const progress = await db.abOnboardingProgress.findUnique({ where: { tenantId } });
  if (!progress) return;

  const completedSteps = [...new Set([...progress.completedSteps, stepId])];
  const currentStep = Math.min(completedSteps.length, ONBOARDING_STEPS.length - 1);

  await db.abOnboardingProgress.update({
    where: { tenantId },
    data: {
      completedSteps,
      currentStep,
      ...(stepId === 'business_type' && {}),
      ...(stepId === 'bank' && { bankConnected: true }),
      ...(stepId === 'accounts' && { accountsSeeded: true }),
      ...(stepId === 'first_expense' && { firstExpense: true }),
      ...(stepId === 'telegram' && { telegramConnected: true }),
      ...(completedSteps.length === ONBOARDING_STEPS.length && { completedAt: new Date() }),
    },
  });
}
