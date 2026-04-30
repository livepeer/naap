/**
 * Dynamic Skill Loader — Loads skills per tenant based on jurisdiction, industry, and marketplace.
 * Skills are layered: base → jurisdiction → industry → marketplace → personalized
 */

export interface SkillBinding {
  skillName: string;
  source: 'base' | 'jurisdiction' | 'industry' | 'marketplace' | 'personalized';
  priority: number;
}

// Base skills per agent (always loaded)
const BASE_SKILLS: Record<string, string[]> = {
  bookkeeper: ['expense-recording', 'receipt-ocr', 'bank-sync', 'pattern-learning', 'anomaly-detection'],
  'tax-strategist': ['tax-estimation', 'deduction-hunting', 'tax-forms', 'year-end-closing'],
  collections: ['invoice-creation', 'time-tracking', 'earnings-projection'],
  insights: ['expense-analytics', 'financial-copilot', 'pattern-learning'],
};

// Jurisdiction-specific skills
const JURISDICTION_SKILLS: Record<string, Record<string, string[]>> = {
  us: {
    'tax-strategist': ['us-schedule-c', 'us-quarterly-estimates', 'us-1099-nec', 'us-section-179'],
    bookkeeper: ['us-sales-tax'],
  },
  ca: {
    'tax-strategist': ['ca-t2125', 'ca-installments', 'ca-t4a', 'ca-rrsp-optimization'],
    bookkeeper: ['ca-gst-hst-pst'],
  },
  uk: {
    'tax-strategist': ['uk-self-assessment', 'uk-vat', 'uk-payments-on-account'],
    bookkeeper: ['uk-vat-tracking'],
  },
  au: {
    'tax-strategist': ['au-bas', 'au-payg', 'au-super-guarantee'],
    bookkeeper: ['au-gst-tracking'],
  },
};

// Industry skill packs
const INDUSTRY_SKILLS: Record<string, Record<string, string[]>> = {
  consultant: {
    collections: ['hourly-billing', 'scope-creep-detection', 'retainer-management'],
    insights: ['effective-rate-analysis'],
  },
  agency: {
    collections: ['project-profitability', 'contractor-management', 'multi-client-billing'],
    insights: ['resource-allocation'],
  },
  ecommerce: {
    bookkeeper: ['inventory-cogs', 'shipping-expense', 'marketplace-fees'],
    'tax-strategist': ['sales-tax-nexus'],
  },
  'real-estate': {
    'tax-strategist': ['property-depreciation', 'rental-income', '1031-exchange'],
    bookkeeper: ['maintenance-tracking'],
  },
};

export function getBaseSkills(agentId: string): SkillBinding[] {
  return (BASE_SKILLS[agentId] || []).map(s => ({ skillName: s, source: 'base' as const, priority: 100 }));
}

export function getJurisdictionSkills(jurisdiction: string, agentId: string): SkillBinding[] {
  const skills = JURISDICTION_SKILLS[jurisdiction]?.[agentId] || [];
  return skills.map(s => ({ skillName: s, source: 'jurisdiction' as const, priority: 90 }));
}

export function getIndustrySkills(industry: string, agentId: string): SkillBinding[] {
  const skills = INDUSTRY_SKILLS[industry]?.[agentId] || [];
  return skills.map(s => ({ skillName: s, source: 'industry' as const, priority: 80 }));
}

export async function loadTenantSkills(
  tenantId: string,
  agentId: string,
  jurisdiction: string,
  industry: string | null,
  db: any,
): Promise<SkillBinding[]> {
  // Layer 1: Base
  const base = getBaseSkills(agentId);

  // Layer 2: Jurisdiction
  const jurisdictionSkills = getJurisdictionSkills(jurisdiction, agentId);

  // Layer 3: Industry
  const industrySkills = industry ? getIndustrySkills(industry, agentId) : [];

  // Layer 4: Marketplace (from DB)
  const marketplaceBindings = await db.abAgentSkillBinding.findMany({
    where: { tenantId, agentId, source: 'marketplace', enabled: true },
  });
  const marketplace: SkillBinding[] = marketplaceBindings.map((b: any) => ({
    skillName: b.skillName,
    source: 'marketplace' as const,
    priority: b.priority,
  }));

  // Layer 5: Personalized (from DB)
  const personalizedBindings = await db.abAgentSkillBinding.findMany({
    where: { tenantId, agentId, source: 'personalized', enabled: true },
  });
  const personalized: SkillBinding[] = personalizedBindings.map((b: any) => ({
    skillName: b.skillName,
    source: 'personalized' as const,
    priority: b.priority,
  }));

  // Merge all layers, deduplicate by skillName (higher priority wins)
  const all = [...base, ...jurisdictionSkills, ...industrySkills, ...marketplace, ...personalized];
  const deduped = new Map<string, SkillBinding>();
  for (const skill of all) {
    const existing = deduped.get(skill.skillName);
    if (!existing || skill.priority > existing.priority) {
      deduped.set(skill.skillName, skill);
    }
  }

  return Array.from(deduped.values()).sort((a, b) => b.priority - a.priority);
}

export function getSupportedIndustries(): string[] {
  return Object.keys(INDUSTRY_SKILLS);
}
