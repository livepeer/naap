import React, { useEffect, useState } from 'react';
import { CheckCircle, Circle, ChevronRight, Building2, Globe, DollarSign, BookOpen, Link2, Receipt, Send } from 'lucide-react';

const CORE_API = '/api/v1/agentbook-core';

interface OnboardingStep {
  id: string;
  title: string;
  description: string;
  completed: boolean;
  icon: React.ReactNode;
}

const STEP_ICONS: Record<string, React.ReactNode> = {
  business_type: <Building2 className="w-5 h-5" />,
  jurisdiction: <Globe className="w-5 h-5" />,
  currency: <DollarSign className="w-5 h-5" />,
  accounts: <BookOpen className="w-5 h-5" />,
  bank: <Link2 className="w-5 h-5" />,
  first_expense: <Receipt className="w-5 h-5" />,
  telegram: <Send className="w-5 h-5" />,
};

export const OnboardingPage: React.FC = () => {
  const [steps, setSteps] = useState<OnboardingStep[]>([]);
  const [currentStep, setCurrentStep] = useState(0);
  const [percentComplete, setPercentComplete] = useState(0);
  const [loading, setLoading] = useState(true);

  // Step-specific state
  const [businessType, setBusinessType] = useState('freelancer');
  const [jurisdiction, setJurisdiction] = useState('us');
  const [region, setRegion] = useState('');
  const [currency, setCurrency] = useState('USD');

  useEffect(() => {
    fetch(`${CORE_API}/onboarding`)
      .then(r => r.json())
      .then(data => {
        if (data.success) {
          setSteps(data.data.steps.map((s: any) => ({ ...s, icon: STEP_ICONS[s.id] })));
          setCurrentStep(data.data.currentStep);
          setPercentComplete(data.data.percentComplete);
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const completeStep = async (stepId: string, extraData?: Record<string, unknown>) => {
    // Update tenant config if relevant
    if (stepId === 'business_type' || stepId === 'jurisdiction' || stepId === 'currency') {
      await fetch(`${CORE_API}/tenant-config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(stepId === 'business_type' && { businessType }),
          ...(stepId === 'jurisdiction' && { jurisdiction, region }),
          ...(stepId === 'currency' && { currency }),
        }),
      });
    }

    // Seed accounts if that step
    if (stepId === 'accounts') {
      await fetch(`${CORE_API}/accounts/seed-jurisdiction`, { method: 'POST' });
    }

    // Mark step complete
    await fetch(`${CORE_API}/onboarding/complete-step`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stepId }),
    });

    // Refresh
    const res = await fetch(`${CORE_API}/onboarding`);
    const data = await res.json();
    if (data.success) {
      setSteps(data.data.steps.map((s: any) => ({ ...s, icon: STEP_ICONS[s.id] })));
      setCurrentStep(data.data.currentStep);
      setPercentComplete(data.data.percentComplete);
    }
  };

  if (loading) return <div className="p-6 text-muted-foreground">Loading...</div>;

  const activeStep = steps[currentStep];

  return (
    <div className="px-4 py-5 sm:p-6 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-2">Welcome to AgentBook</h1>
      <p className="text-muted-foreground mb-6">Let's set up your accounting in under 10 minutes.</p>

      {/* Progress bar */}
      <div className="mb-8">
        <div className="flex justify-between text-sm mb-2">
          <span className="text-muted-foreground">Setup Progress</span>
          <span className="font-medium">{Math.round(percentComplete * 100)}%</span>
        </div>
        <div className="h-2 bg-muted rounded-full overflow-hidden">
          <div className="h-full bg-primary rounded-full transition-all duration-500" style={{ width: `${percentComplete * 100}%` }} />
        </div>
      </div>

      {/* Step list */}
      <div className="space-y-3 mb-8">
        {steps.map((step, i) => (
          <button
            key={step.id}
            onClick={() => !step.completed && setCurrentStep(i)}
            className={`w-full flex items-center gap-4 p-4 rounded-xl border transition-all text-left ${
              i === currentStep && !step.completed
                ? 'border-primary bg-primary/5'
                : step.completed
                  ? 'border-green-500/30 bg-green-500/5'
                  : 'border-border bg-card hover:border-muted-foreground/30'
            }`}
          >
            <div className={`shrink-0 ${step.completed ? 'text-green-500' : i === currentStep ? 'text-primary' : 'text-muted-foreground'}`}>
              {step.completed ? <CheckCircle className="w-6 h-6" /> : step.icon || <Circle className="w-6 h-6" />}
            </div>
            <div className="flex-1 min-w-0">
              <p className={`font-medium ${step.completed ? 'text-green-600 line-through' : ''}`}>{step.title}</p>
              <p className="text-sm text-muted-foreground">{step.description}</p>
            </div>
            {!step.completed && i === currentStep && <ChevronRight className="w-5 h-5 text-primary shrink-0" />}
          </button>
        ))}
      </div>

      {/* Active step form */}
      {activeStep && !activeStep.completed && (
        <div className="bg-card border border-border rounded-xl p-6">
          <h2 className="font-bold mb-4">{activeStep.title}</h2>

          {activeStep.id === 'business_type' && (
            <div className="space-y-3">
              {['freelancer', 'sole_proprietor', 'consultant', 'contractor'].map(type => (
                <button key={type} onClick={() => setBusinessType(type)}
                  className={`w-full p-3 rounded-lg border text-left capitalize ${businessType === type ? 'border-primary bg-primary/10' : 'border-border'}`}>
                  {type.replace('_', ' ')}
                </button>
              ))}
              <button onClick={() => completeStep('business_type')}
                className="w-full py-3 bg-primary text-primary-foreground rounded-lg font-medium mt-4">
                Continue
              </button>
            </div>
          )}

          {activeStep.id === 'jurisdiction' && (
            <div className="space-y-3">
              {[{ code: 'us', name: 'United States', flag: '\u{1F1FA}\u{1F1F8}' }, { code: 'ca', name: 'Canada', flag: '\u{1F1E8}\u{1F1E6}' }, { code: 'uk', name: 'United Kingdom', flag: '\u{1F1EC}\u{1F1E7}' }, { code: 'au', name: 'Australia', flag: '\u{1F1E6}\u{1F1FA}' }].map(j => (
                <button key={j.code} onClick={() => setJurisdiction(j.code)}
                  className={`w-full p-3 rounded-lg border text-left ${jurisdiction === j.code ? 'border-primary bg-primary/10' : 'border-border'}`}>
                  {j.flag} {j.name}
                </button>
              ))}
              <input type="text" placeholder="State / Province" value={region} onChange={e => setRegion(e.target.value)}
                className="w-full p-3 border border-border rounded-lg bg-background mt-2" />
              <button onClick={() => completeStep('jurisdiction')}
                className="w-full py-3 bg-primary text-primary-foreground rounded-lg font-medium mt-2">
                Continue
              </button>
            </div>
          )}

          {activeStep.id === 'currency' && (
            <div className="space-y-3">
              {['USD', 'CAD', 'GBP', 'EUR', 'AUD'].map(c => (
                <button key={c} onClick={() => setCurrency(c)}
                  className={`w-full p-3 rounded-lg border text-left ${currency === c ? 'border-primary bg-primary/10' : 'border-border'}`}>
                  {c}
                </button>
              ))}
              <button onClick={() => completeStep('currency')}
                className="w-full py-3 bg-primary text-primary-foreground rounded-lg font-medium mt-2">
                Continue
              </button>
            </div>
          )}

          {activeStep.id === 'accounts' && (
            <div>
              <p className="text-muted-foreground mb-4">We'll create a chart of accounts based on your tax jurisdiction ({jurisdiction.toUpperCase()}).</p>
              <button onClick={() => completeStep('accounts')}
                className="w-full py-3 bg-primary text-primary-foreground rounded-lg font-medium">
                Create Chart of Accounts
              </button>
            </div>
          )}

          {activeStep.id === 'bank' && (
            <div>
              <p className="text-muted-foreground mb-4">Connect your bank account to automatically import transactions.</p>
              <button onClick={() => completeStep('bank')}
                className="w-full py-3 bg-primary text-primary-foreground rounded-lg font-medium mb-2">
                Connect with Plaid
              </button>
              <button onClick={() => completeStep('bank')}
                className="w-full py-3 bg-muted text-muted-foreground rounded-lg font-medium">
                Skip for now
              </button>
            </div>
          )}

          {activeStep.id === 'first_expense' && (
            <div>
              <p className="text-muted-foreground mb-4">Record your first expense to see AgentBook in action.</p>
              <button onClick={() => { window.location.href = '/agentbook/expenses/new'; }}
                className="w-full py-3 bg-primary text-primary-foreground rounded-lg font-medium mb-2">
                Record an Expense
              </button>
              <button onClick={() => completeStep('first_expense')}
                className="w-full py-3 bg-muted text-muted-foreground rounded-lg font-medium">
                Skip for now
              </button>
            </div>
          )}

          {activeStep.id === 'telegram' && (
            <div>
              <p className="text-muted-foreground mb-4">Connect Telegram to snap receipts and get proactive notifications.</p>
              <p className="text-sm bg-muted p-3 rounded-lg font-mono mb-4">Open Telegram &rarr; Search @AgentBookBot &rarr; Send /start</p>
              <button onClick={() => completeStep('telegram')}
                className="w-full py-3 bg-primary text-primary-foreground rounded-lg font-medium mb-2">
                I've Connected
              </button>
              <button onClick={() => completeStep('telegram')}
                className="w-full py-3 bg-muted text-muted-foreground rounded-lg font-medium">
                Skip for now
              </button>
            </div>
          )}
        </div>
      )}

      {percentComplete === 1 && (
        <div className="bg-green-500/10 border border-green-500/30 rounded-xl p-6 text-center">
          <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-3" />
          <h2 className="text-xl font-bold text-green-600 mb-2">You're all set!</h2>
          <p className="text-muted-foreground mb-4">AgentBook is ready to manage your finances.</p>
          <button onClick={() => { window.location.href = '/agentbook'; }}
            className="px-6 py-3 bg-primary text-primary-foreground rounded-lg font-medium">
            Go to Dashboard
          </button>
        </div>
      )}
    </div>
  );
};
