import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { X, Key, Copy, Check, AlertTriangle } from 'lucide-react';
import { getServiceOrigin } from '@naap/plugin-sdk';

interface CreateKeyModalProps {
  providerDisplayName: string;
  onClose: () => void;
  onSuccess: (key: { projectName: string; providerDisplayName: string; rawKey: string }) => void;
}

export const CreateKeyModal: React.FC<CreateKeyModalProps> = ({
  providerDisplayName,
  onClose,
  onSuccess,
}) => {
  const [step, setStep] = useState<'form' | 'success'>('form');
  const [projectName, setProjectName] = useState('');
  const [generatedKey, setGeneratedKey] = useState('');
  const [copied, setCopied] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  const isValid = projectName.trim().length > 0;

  const handleSubmit = async () => {
    if (!isValid) return;

    setSubmitting(true);
    setSubmitError('');
    try {
      const response = await fetch(`${getServiceOrigin('developer-api')}/api/v1/developer/keys`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectName: projectName.trim(), providerDisplayName }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error || `Request failed: ${response.status}`);
      }
      const data = await response.json() as unknown;
      const rawApiKey = data != null && typeof (data as Record<string, unknown>).rawApiKey === 'string'
        ? (data as { rawApiKey: string }).rawApiKey
        : '';
      if (!rawApiKey) {
        throw new Error('Server returned an invalid API key');
      }
      setGeneratedKey(rawApiKey);
      setStep('success');
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to create API key');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(generatedKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = generatedKey;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const success = document.execCommand('copy');
      document.body.removeChild(ta);
      if (success) {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    }
  };

  const handleDone = () => {
    onSuccess({
      projectName: projectName.trim(),
      providerDisplayName,
      rawKey: generatedKey,
    });
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-bg-secondary border border-white/10 rounded-2xl w-full max-w-lg overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-white/10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-accent-emerald/10 flex items-center justify-center">
              <Key size={20} className="text-accent-emerald" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-text-primary">Create API Key</h2>
              <p className="text-sm text-text-secondary">Generate credentials for your project</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white/5 rounded-lg transition-colors">
            <X size={20} className="text-text-secondary" />
          </button>
        </div>

        {step === 'form' ? (
          <div className="p-6 space-y-5">
            {/* Project Name */}
            <div>
              <label className="block text-sm font-medium text-text-primary mb-2">
                Project Name <span className="text-accent-rose">*</span>
              </label>
              <input
                type="text"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                placeholder="e.g., My Video App"
                className="w-full bg-bg-tertiary border border-white/10 rounded-xl py-3 px-4 text-sm focus:outline-none focus:border-accent-emerald transition-all"
              />
            </div>

            {/* Summary */}
            {isValid && (
              <div className="p-4 bg-bg-tertiary/50 rounded-xl">
                <h4 className="text-sm font-medium text-text-primary mb-2">Summary</h4>
                <div className="space-y-1 text-xs text-text-secondary">
                  <p>
                    Provider: <span className="text-text-primary">{providerDisplayName}</span>
                  </p>
                </div>
              </div>
            )}

            {/* Error */}
            {submitError && (
              <p className="text-xs text-accent-rose px-1">{submitError}</p>
            )}

            {/* Submit */}
            <button
              onClick={handleSubmit}
              disabled={!isValid || submitting}
              className={`w-full py-3 rounded-xl font-bold transition-all ${
                isValid && !submitting
                  ? 'bg-accent-emerald text-white hover:bg-accent-emerald/90'
                  : 'bg-bg-tertiary text-text-secondary cursor-not-allowed'
              }`}
            >
              {submitting ? 'Creating…' : 'Create API Key'}
            </button>
          </div>
        ) : (
          <div className="p-6 space-y-5">
            {/* Warning */}
            <div className="flex items-start gap-3 p-4 bg-accent-amber/10 border border-accent-amber/20 rounded-xl">
              <AlertTriangle size={20} className="text-accent-amber shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-text-primary">Save your API key</p>
                <p className="text-xs text-text-secondary mt-1">
                  This key will only be shown once. Make sure to copy and store it securely.
                </p>
              </div>
            </div>

            {/* Generated Key */}
            <div>
              <label className="block text-sm font-medium text-text-primary mb-2">Your API Key</label>
              <div className="flex items-center gap-2">
                <div className="flex-1 bg-bg-tertiary border border-white/10 rounded-xl py-3 px-4 font-mono text-sm text-text-primary overflow-x-auto">
                  {generatedKey}
                </div>
                <button
                  onClick={handleCopy}
                  className={`shrink-0 p-3 rounded-xl transition-all ${
                    copied
                      ? 'bg-accent-emerald text-white'
                      : 'bg-bg-tertiary text-text-secondary hover:text-text-primary'
                  }`}
                >
                  {copied ? <Check size={20} /> : <Copy size={20} />}
                </button>
              </div>
            </div>

            {/* Project Info */}
            <div className="p-4 bg-bg-tertiary/50 rounded-xl text-sm">
              <p className="text-text-secondary">
                Project: <span className="text-text-primary">{projectName}</span>
              </p>
              <p className="text-text-secondary mt-1">
                Provider: <span className="text-text-primary">{providerDisplayName}</span>
              </p>
            </div>

            {/* Done */}
            <button
              onClick={handleDone}
              className="w-full py-3 bg-accent-emerald text-white rounded-xl font-bold hover:bg-accent-emerald/90 transition-all"
            >
              Done
            </button>
          </div>
        )}
      </motion.div>
    </div>
  );
};
