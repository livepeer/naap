import React, { useState } from 'react';
import { X, Zap, AlertTriangle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import type { NewRequestFormData, CapacityRequest } from '../types';
import {
  GPU_MODELS,
  VRAM_OPTIONS,
  CUDA_VERSIONS,
  OS_OPTIONS,
  PIPELINE_OPTIONS,
  RISK_LABELS,
} from '../types';

interface NewRequestModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (request: CapacityRequest) => void;
}

const initialForm: NewRequestFormData = {
  requesterName: '',
  gpuModel: '',
  vram: '',
  osVersion: '',
  cudaVersion: '',
  count: '1',
  pipeline: '',
  startDate: '',
  endDate: '',
  validUntil: '',
  hourlyRate: '',
  reason: '',
  riskLevel: 3,
};

export const NewRequestModal: React.FC<NewRequestModalProps> = ({ isOpen, onClose, onSubmit }) => {
  const [form, setForm] = useState<NewRequestFormData>(initialForm);
  const [errors, setErrors] = useState<Partial<Record<keyof NewRequestFormData, string>>>({});
  const [step, setStep] = useState<1 | 2>(1);

  const updateField = <K extends keyof NewRequestFormData>(field: K, value: NewRequestFormData[K]) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }
  };

  const validateStep1 = (): boolean => {
    const errs: Partial<Record<keyof NewRequestFormData, string>> = {};
    if (!form.requesterName.trim()) errs.requesterName = 'Required';
    if (!form.gpuModel) errs.gpuModel = 'Select a GPU model';
    if (!form.vram) errs.vram = 'Select VRAM';
    if (!form.count || parseInt(form.count) < 1) errs.count = 'Must be at least 1';
    if (!form.pipeline) errs.pipeline = 'Select a pipeline';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const validateStep2 = (): boolean => {
    const errs: Partial<Record<keyof NewRequestFormData, string>> = {};
    if (!form.startDate) errs.startDate = 'Required';
    if (!form.endDate) errs.endDate = 'Required';
    if (!form.validUntil) errs.validUntil = 'Required';
    if (!form.hourlyRate || parseFloat(form.hourlyRate) <= 0) errs.hourlyRate = 'Must be > 0';
    if (!form.reason.trim()) errs.reason = 'Provide a reason';
    if (form.startDate && form.endDate && form.startDate >= form.endDate) {
      errs.endDate = 'End must be after start';
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleNext = () => {
    if (validateStep1()) setStep(2);
  };

  const handleSubmit = () => {
    if (!validateStep2()) return;

    const newRequest: CapacityRequest = {
      id: `req-${Date.now()}`,
      requesterName: form.requesterName.trim(),
      requesterAccount: '0xYOUR...ADDR',
      gpuModel: form.gpuModel,
      vram: parseInt(form.vram),
      osVersion: form.osVersion || 'Any',
      cudaVersion: form.cudaVersion || 'Any',
      count: parseInt(form.count),
      pipeline: form.pipeline,
      startDate: form.startDate,
      endDate: form.endDate,
      validUntil: form.validUntil,
      hourlyRate: parseFloat(form.hourlyRate),
      reason: form.reason.trim(),
      riskLevel: form.riskLevel,
      softCommits: [],
      comments: [],
      createdAt: new Date().toISOString(),
      status: 'active',
    };

    onSubmit(newRequest);
    setForm(initialForm);
    setStep(1);
    setErrors({});
    onClose();
  };

  const handleClose = () => {
    setForm(initialForm);
    setStep(1);
    setErrors({});
    onClose();
  };

  if (!isOpen) return null;

  const inputCls =
    'w-full bg-bg-tertiary border border-[var(--border-color)] rounded-xl px-3 py-2.5 text-sm text-text-primary focus:outline-none focus:border-accent-blue transition-colors placeholder:text-text-secondary/50';
  const selectCls =
    'w-full bg-bg-tertiary border border-[var(--border-color)] rounded-xl px-3 py-2.5 text-sm text-text-primary focus:outline-none focus:border-accent-blue transition-colors appearance-none cursor-pointer';
  const labelCls = 'block text-xs font-semibold text-text-secondary uppercase tracking-wider mb-1.5';
  const errorCls = 'text-[11px] text-accent-rose mt-1';

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          onClick={handleClose}
        />
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          transition={{ duration: 0.2 }}
          className="relative w-full max-w-2xl bg-bg-secondary border border-[var(--border-color)] rounded-2xl shadow-2xl max-h-[90vh] flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-[var(--border-color)]">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-accent-blue/10 text-accent-blue rounded-xl">
                <Zap size={20} />
              </div>
              <div>
                <h2 className="text-lg font-bold text-text-primary">New Capacity Request</h2>
                <p className="text-xs text-text-secondary">
                  Step {step} of 2 &mdash; {step === 1 ? 'GPU Specifications' : 'Timing & Details'}
                </p>
              </div>
            </div>
            <button
              onClick={handleClose}
              className="p-2 rounded-lg hover:bg-white/5 text-text-secondary hover:text-text-primary transition-colors"
            >
              <X size={20} />
            </button>
          </div>

          {/* Progress bar */}
          <div className="h-1 bg-bg-tertiary">
            <div
              className="h-full bg-accent-blue transition-all duration-300 rounded-full"
              style={{ width: step === 1 ? '50%' : '100%' }}
            />
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-6">
            {step === 1 ? (
              <div className="space-y-4">
                {/* Requester Name */}
                <div>
                  <label className={labelCls}>Your Name / Organization *</label>
                  <input
                    type="text"
                    value={form.requesterName}
                    onChange={(e) => updateField('requesterName', e.target.value)}
                    placeholder="e.g., Livepeer Studio - AI Video Team"
                    className={`${inputCls} ${errors.requesterName ? 'border-accent-rose' : ''}`}
                  />
                  {errors.requesterName && <p className={errorCls}>{errors.requesterName}</p>}
                </div>

                {/* GPU Model + Count */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className={labelCls}>GPU Model *</label>
                    <select
                      value={form.gpuModel}
                      onChange={(e) => updateField('gpuModel', e.target.value)}
                      className={`${selectCls} ${errors.gpuModel ? 'border-accent-rose' : ''}`}
                    >
                      <option value="">Select GPU...</option>
                      {GPU_MODELS.map((gpu) => (
                        <option key={gpu} value={gpu}>{gpu}</option>
                      ))}
                    </select>
                    {errors.gpuModel && <p className={errorCls}>{errors.gpuModel}</p>}
                  </div>
                  <div>
                    <label className={labelCls}>Count Needed *</label>
                    <input
                      type="number"
                      min={1}
                      max={100}
                      value={form.count}
                      onChange={(e) => updateField('count', e.target.value)}
                      className={`${inputCls} ${errors.count ? 'border-accent-rose' : ''}`}
                    />
                    {errors.count && <p className={errorCls}>{errors.count}</p>}
                  </div>
                </div>

                {/* VRAM + CUDA */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className={labelCls}>VRAM (GB) *</label>
                    <select
                      value={form.vram}
                      onChange={(e) => updateField('vram', e.target.value)}
                      className={`${selectCls} ${errors.vram ? 'border-accent-rose' : ''}`}
                    >
                      <option value="">Select VRAM...</option>
                      {VRAM_OPTIONS.map((v) => (
                        <option key={v} value={v}>{v} GB</option>
                      ))}
                    </select>
                    {errors.vram && <p className={errorCls}>{errors.vram}</p>}
                  </div>
                  <div>
                    <label className={labelCls}>CUDA Version</label>
                    <select
                      value={form.cudaVersion}
                      onChange={(e) => updateField('cudaVersion', e.target.value)}
                      className={selectCls}
                    >
                      <option value="">Any</option>
                      {CUDA_VERSIONS.map((v) => (
                        <option key={v} value={v}>CUDA {v}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* OS + Pipeline */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className={labelCls}>OS Version</label>
                    <select
                      value={form.osVersion}
                      onChange={(e) => updateField('osVersion', e.target.value)}
                      className={selectCls}
                    >
                      <option value="">Any</option>
                      {OS_OPTIONS.map((os) => (
                        <option key={os} value={os}>{os}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className={labelCls}>Pipeline *</label>
                    <select
                      value={form.pipeline}
                      onChange={(e) => updateField('pipeline', e.target.value)}
                      className={`${selectCls} ${errors.pipeline ? 'border-accent-rose' : ''}`}
                    >
                      <option value="">Select pipeline...</option>
                      {PIPELINE_OPTIONS.map((p) => (
                        <option key={p} value={p}>{p}</option>
                      ))}
                    </select>
                    {errors.pipeline && <p className={errorCls}>{errors.pipeline}</p>}
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Date range */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className={labelCls}>Start Date *</label>
                    <input
                      type="date"
                      value={form.startDate}
                      onChange={(e) => updateField('startDate', e.target.value)}
                      className={`${inputCls} ${errors.startDate ? 'border-accent-rose' : ''}`}
                    />
                    {errors.startDate && <p className={errorCls}>{errors.startDate}</p>}
                  </div>
                  <div>
                    <label className={labelCls}>End Date *</label>
                    <input
                      type="date"
                      value={form.endDate}
                      onChange={(e) => updateField('endDate', e.target.value)}
                      className={`${inputCls} ${errors.endDate ? 'border-accent-rose' : ''}`}
                    />
                    {errors.endDate && <p className={errorCls}>{errors.endDate}</p>}
                  </div>
                </div>

                {/* Valid until */}
                <div>
                  <label className={labelCls}>Request Valid Until *</label>
                  <p className="text-[11px] text-text-secondary mb-1.5">
                    After this date, the request is automatically removed from the board.
                  </p>
                  <input
                    type="date"
                    value={form.validUntil}
                    onChange={(e) => updateField('validUntil', e.target.value)}
                    className={`${inputCls} ${errors.validUntil ? 'border-accent-rose' : ''}`}
                  />
                  {errors.validUntil && <p className={errorCls}>{errors.validUntil}</p>}
                </div>

                {/* Hourly rate */}
                <div>
                  <label className={labelCls}>Hourly Rate (USD) *</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary text-sm">$</span>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={form.hourlyRate}
                      onChange={(e) => updateField('hourlyRate', e.target.value)}
                      placeholder="0.00"
                      className={`${inputCls} pl-7 ${errors.hourlyRate ? 'border-accent-rose' : ''}`}
                    />
                  </div>
                  {errors.hourlyRate && <p className={errorCls}>{errors.hourlyRate}</p>}
                </div>

                {/* Reason */}
                <div>
                  <label className={labelCls}>Reason *</label>
                  <textarea
                    value={form.reason}
                    onChange={(e) => updateField('reason', e.target.value)}
                    placeholder="Explain why you need this capacity..."
                    rows={3}
                    className={`${inputCls} resize-none ${errors.reason ? 'border-accent-rose' : ''}`}
                  />
                  {errors.reason && <p className={errorCls}>{errors.reason}</p>}
                </div>

                {/* Risk Level */}
                <div>
                  <label className={labelCls}>
                    <span className="flex items-center gap-1">
                      <AlertTriangle size={12} />
                      Demand Confidence (Risk Level)
                    </span>
                  </label>
                  <p className="text-[11px] text-text-secondary mb-2">
                    How likely is this demand to materialize? 5 = very high confidence.
                  </p>
                  <div className="flex gap-2">
                    {([1, 2, 3, 4, 5] as const).map((level) => {
                      const info = RISK_LABELS[level];
                      const isSelected = form.riskLevel === level;
                      const bgColor =
                        level <= 2
                          ? 'bg-accent-blue/20 border-accent-blue text-accent-blue'
                          : level <= 3
                          ? 'bg-accent-amber/20 border-accent-amber text-accent-amber'
                          : 'bg-accent-rose/20 border-accent-rose text-accent-rose';
                      return (
                        <button
                          key={level}
                          type="button"
                          onClick={() => updateField('riskLevel', level)}
                          className={`flex-1 py-2.5 rounded-xl border text-xs font-semibold transition-all ${
                            isSelected
                              ? bgColor
                              : 'border-[var(--border-color)] text-text-secondary hover:border-text-secondary/30'
                          }`}
                        >
                          <div className="text-lg mb-0.5">{level}</div>
                          <div className="text-[10px]">{info.label}</div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between p-6 border-t border-[var(--border-color)] bg-bg-tertiary/30">
            {step === 2 && (
              <button
                onClick={() => setStep(1)}
                className="px-5 py-2.5 rounded-xl text-sm font-medium text-text-secondary hover:text-text-primary hover:bg-white/5 transition-all"
              >
                Back
              </button>
            )}
            <div className="flex-1" />
            <button
              onClick={step === 1 ? handleNext : handleSubmit}
              className="px-6 py-2.5 bg-accent-blue text-white rounded-xl font-bold text-sm shadow-lg shadow-accent-blue/20 hover:bg-accent-blue/90 transition-all"
            >
              {step === 1 ? 'Next: Timing & Details' : 'Submit Request'}
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
