import { useEffect, useState } from 'react';
import { loadStripe, type Stripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { meApi, type Plan } from '../lib/api';

declare global {
  interface Window {
    STRIPE_PUBLISHABLE_KEY?: string;
  }
}

let _stripePromise: Promise<Stripe | null> | null = null;
function stripePromise(): Promise<Stripe | null> {
  if (!_stripePromise) {
    const key = window.STRIPE_PUBLISHABLE_KEY ?? '';
    _stripePromise = loadStripe(key);
  }
  return _stripePromise;
}

function PayForm({ plan, onDone }: { plan: Plan; onDone: () => void }): JSX.Element {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!stripe || !elements) return;
    setBusy(true);
    setErr(null);
    const { error, setupIntent } = await stripe.confirmSetup({
      elements,
      confirmParams: { return_url: window.location.href },
      redirect: 'if_required',
    });
    if (error) {
      setErr(error.message ?? 'Payment failed');
      setBusy(false);
      return;
    }
    const pmId =
      typeof setupIntent?.payment_method === 'string'
        ? setupIntent.payment_method
        : setupIntent?.payment_method?.id;
    if (!pmId) {
      setErr('No payment method returned by Stripe');
      setBusy(false);
      return;
    }
    try {
      await meApi.subscribe(plan.id, pmId);
      onDone();
    } catch (e2) {
      setErr(String(e2));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit}>
      <PaymentElement />
      {err && <div className="mt-2 rounded bg-red-50 p-2 text-sm text-red-700">{err}</div>}
      <button
        type="submit"
        disabled={!stripe || busy}
        className="mt-4 w-full rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-50"
      >
        {busy ? 'Processing…' : `Subscribe to ${plan.name}`}
      </button>
    </form>
  );
}

export function SubscribeModal({
  plan,
  onClose,
  onDone,
}: {
  plan: Plan;
  onClose: () => void;
  onDone: () => void;
}): JSX.Element {
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    meApi.intent().then((r) => setClientSecret(r.clientSecret)).catch((e) => setErr(String(e)));
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-[480px] rounded-lg bg-white p-6">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold">Upgrade to {plan.name}</h3>
          <button onClick={onClose} aria-label="close" className="text-gray-500">×</button>
        </div>
        {err && <div className="rounded bg-red-50 p-3 text-sm text-red-700">{err}</div>}
        {!clientSecret ? (
          <div className="text-sm text-gray-500">Preparing checkout…</div>
        ) : (
          <Elements stripe={stripePromise()} options={{ clientSecret, appearance: { theme: 'stripe' } }}>
            <PayForm plan={plan} onDone={onDone} />
          </Elements>
        )}
      </div>
    </div>
  );
}
