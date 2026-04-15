export interface StepQuality { score: number; issues: string[]; }

export interface Evaluation {
  planSuccess: boolean;
  stepsCompleted: number;
  stepsFailed: number;
  stepsSkipped: number;
  qualityScore: number;
  issues: string[];
  suggestions: string[];
  undoAvailable: boolean;
  summary: string;
}

export interface PlanStep {
  id: string;
  action: string;
  description: string;
  params: Record<string, any>;
  dependsOn: string[];
  canUndo: boolean;
  status: 'pending' | 'running' | 'done' | 'failed' | 'skipped';
  result?: any;
  quality?: StepQuality;
}

export function assessStepQuality(step: PlanStep): StepQuality {
  if (!step.result?.success) {
    const error = step.result?.error ?? 'unknown error';
    return { score: 0, issues: [`Step failed: ${error}`] };
  }

  const issues: string[] = [];
  let score = 1.0;

  if (step.action === 'record-expense') {
    if (!step.result?.categoryId) { score -= 0.3; issues.push('Expense recorded without a category'); }
    if (!step.result?.vendorId) { score -= 0.1; issues.push('Expense recorded without a vendor'); }
    const confidence = step.result?.confidence ?? 1;
    if (confidence < 0.7) { score -= 0.2; issues.push(`Low confidence score: ${confidence}`); }
  } else if (step.action === 'categorize-expenses') {
    const msg: string = step.result?.message ?? '';
    const match = msg.match(/Categorized\s+\*{0,2}(\d+)\*{0,2}\s+of\s+(\d+)/i);
    if (match) {
      const n = parseInt(match[1], 10);
      const m = parseInt(match[2], 10);
      score = m > 0 ? n / m : 1;
      if (score < 0.5) issues.push(`Only ${n} of ${m} expenses categorized`);
      const skippedMatch = msg.match(/(\d+)\s+skipped/i);
      if (skippedMatch) issues.push(`${skippedMatch[1]} expenses skipped during categorization`);
    }
  }

  return { score: Math.max(0, Math.min(1, score)), issues };
}

export function buildFinalEvaluation(plan: PlanStep[]): Evaluation {
  let stepsCompleted = 0, stepsFailed = 0, stepsSkipped = 0;
  const allIssues: string[] = [];
  let qualitySum = 0;
  let undoAvailable = false;

  for (const step of plan) {
    if (step.status === 'done') {
      stepsCompleted++;
      const q = step.quality ?? assessStepQuality(step);
      qualitySum += q.score;
      allIssues.push(...q.issues);
      if (step.canUndo) undoAvailable = true;
    } else if (step.status === 'failed') {
      stepsFailed++;
      const q = step.quality ?? assessStepQuality(step);
      allIssues.push(...q.issues);
    } else if (step.status === 'skipped') {
      stepsSkipped++;
    }
  }

  const qualityScore = stepsCompleted > 0 ? qualitySum / stepsCompleted : 0;
  const planSuccess = stepsFailed === 0 && stepsSkipped === 0;

  const suggestions: string[] = [];
  const issueText = allIssues.join(' ').toLowerCase();
  if (issueText.includes('without a category') || issueText.includes('categorized')) {
    suggestions.push('Would you like me to categorize uncategorized expenses?');
  }
  if (issueText.includes('confidence') || issueText.includes('manual')) {
    suggestions.push('Some items may need manual review — want me to show them?');
  }
  if (stepsFailed > 0) {
    suggestions.push(`${stepsFailed} step(s) failed — want me to retry?`);
  }
  if (suggestions.length === 0 && qualityScore > 0.8 && stepsFailed === 0) {
    suggestions.push('Everything looks good!');
  }

  const total = plan.length;
  const pct = Math.round(qualityScore * 100);
  const status = planSuccess ? 'complete' : 'completed with errors';
  const summary = `Plan ${status}. ${stepsCompleted}/${total} steps done. Quality: ${pct}%.`;

  return {
    planSuccess,
    stepsCompleted,
    stepsFailed,
    stepsSkipped,
    qualityScore,
    issues: allIssues,
    suggestions,
    undoAvailable,
    summary,
  };
}

export function formatEvaluation(ev: Evaluation, steps: PlanStep[]): string {
  const lines: string[] = [];

  lines.push(ev.planSuccess ? '**Plan complete**' : '**Plan completed with errors**');
  lines.push('');

  for (const step of steps) {
    const icon = step.status === 'done' ? '✓' : step.status === 'failed' ? '✗' : '–';
    lines.push(`${icon} ${step.description}`);
  }

  if (ev.issues.length > 0) {
    lines.push('');
    lines.push('**Issues:**');
    for (const issue of ev.issues.slice(0, 5)) {
      lines.push(`• ${issue}`);
    }
  }

  if (ev.suggestions.length > 0) {
    lines.push('');
    lines.push('**Suggestions:**');
    for (const s of ev.suggestions) {
      lines.push(`• ${s}`);
    }
  }

  if (ev.undoAvailable) {
    lines.push('');
    lines.push('(Reply "undo" to revert)');
  }

  return lines.join('\n');
}
