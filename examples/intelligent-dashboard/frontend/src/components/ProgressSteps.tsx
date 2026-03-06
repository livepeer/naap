import React from 'react';
import { Search, Database, Palette, LayoutDashboard } from 'lucide-react';
import type { AgentStep } from '../types';

const STEPS: Array<{ key: AgentStep; label: string; icon: React.ElementType }> = [
  { key: 'analyzing', label: 'Analyzing intent', icon: Search },
  { key: 'fetching', label: 'Fetching data', icon: Database },
  { key: 'designing', label: 'Designing layout', icon: Palette },
  { key: 'rendering', label: 'Rendering', icon: LayoutDashboard },
];

interface ProgressStepsProps {
  currentStep: AgentStep;
  detail?: string;
}

export const ProgressSteps: React.FC<ProgressStepsProps> = ({ currentStep, detail }) => {
  const stepOrder = STEPS.map((s) => s.key);
  const currentIdx = stepOrder.indexOf(currentStep);

  if (currentStep === 'idle' || currentStep === 'complete' || currentStep === 'error') return null;

  return (
    <div className="flex items-center gap-2 px-4 py-3 bg-white/5 border border-white/10 rounded-xl">
      {STEPS.map((step, i) => {
        const Icon = step.icon;
        const isActive = i === currentIdx;
        const isDone = i < currentIdx;

        return (
          <React.Fragment key={step.key}>
            {i > 0 && (
              <div className={`flex-1 h-px max-w-8 ${isDone ? 'bg-purple-500' : 'bg-white/10'}`} />
            )}
            <div className="flex items-center gap-1.5">
              <div
                className={`w-6 h-6 rounded-full flex items-center justify-center transition-all ${
                  isActive
                    ? 'bg-purple-500 text-white animate-pulse'
                    : isDone
                    ? 'bg-purple-500/20 text-purple-400'
                    : 'bg-white/5 text-gray-600'
                }`}
              >
                <Icon className="w-3 h-3" />
              </div>
              <span
                className={`text-xs font-medium hidden sm:inline ${
                  isActive ? 'text-purple-300' : isDone ? 'text-gray-400' : 'text-gray-600'
                }`}
              >
                {step.label}
              </span>
            </div>
          </React.Fragment>
        );
      })}
      {detail && (
        <span className="ml-auto text-xs text-gray-500 truncate max-w-48">{detail}</span>
      )}
    </div>
  );
};
