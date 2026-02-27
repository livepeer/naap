/**
 * AgentOrchestrator
 *
 * Coordinates the AnalyticSkill and UXSkill to turn a user question
 * into a rendered dashboard. Uses callbacks to report progress so the
 * UI can update progressively at each step.
 */

import type { IAnalyticSkill, IUXSkill, AgentCallbacks } from '../skills/types';

export class AgentOrchestrator {
  constructor(
    private analyticSkill: IAnalyticSkill,
    private uxSkill: IUXSkill,
  ) {}

  async run(question: string, callbacks: AgentCallbacks): Promise<void> {
    try {
      callbacks.onStep('analyzing', 'Understanding your question...');
      const plan = await this.analyticSkill.analyzeIntent(question);

      callbacks.onStep('fetching', `Querying ${plan.pipeline} / ${plan.model}...`);
      const data = await this.analyticSkill.executeQuery(plan);

      if (data.orchestrators.length === 0) {
        callbacks.onError('No orchestrator data found for this pipeline and model combination.');
        return;
      }

      callbacks.onStep('designing', 'Choosing the best visualization...');
      const renderSpec = await this.uxSkill.generateRenderSpec(question, data);

      callbacks.onStep('rendering');
      callbacks.onComplete(renderSpec, data, renderSpec.summary);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'An unexpected error occurred';
      callbacks.onError(msg);
    }
  }
}
