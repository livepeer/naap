/**
 * Skill Marketplace — Discover, install, and publish AgentBook skills.
 * Third-party skills and jurisdiction packs published via plugin-publisher.
 */

export interface MarketplaceSkill {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  category: 'jurisdiction' | 'integration' | 'analytics' | 'automation';
  downloads: number;
  rating: number;
  installed: boolean;
}

export interface PublishResult {
  success: boolean;
  skillId?: string;
  error?: string;
}

// Built-in skills registry (marketplace would query a central API in production)
const BUILT_IN_SKILLS: MarketplaceSkill[] = [
  { id: 'expense-recording', name: 'Expense Recording', version: '1.0.0', description: 'Record expenses from text, photo, or document', author: 'A3P Team', category: 'automation', downloads: 0, rating: 5, installed: true },
  { id: 'receipt-ocr', name: 'Receipt OCR', version: '1.0.0', description: 'Extract data from receipt photos via LLM vision', author: 'A3P Team', category: 'automation', downloads: 0, rating: 5, installed: true },
  { id: 'invoice-creation', name: 'Invoice Creation', version: '1.0.0', description: 'Create invoices from natural language', author: 'A3P Team', category: 'automation', downloads: 0, rating: 5, installed: true },
  { id: 'tax-estimation', name: 'Tax Estimation', version: '1.0.0', description: 'Real-time tax estimates with jurisdiction support', author: 'A3P Team', category: 'analytics', downloads: 0, rating: 5, installed: true },
  { id: 'stripe-payments', name: 'Stripe Payments', version: '1.0.0', description: 'Stripe webhook processing and payment matching', author: 'A3P Team', category: 'integration', downloads: 0, rating: 5, installed: true },
  { id: 'bank-sync', name: 'Bank Sync (Plaid)', version: '1.0.0', description: 'Plaid bank connection and auto-reconciliation', author: 'A3P Team', category: 'integration', downloads: 0, rating: 5, installed: true },
  { id: 'jurisdiction-us', name: 'US Tax Pack', version: '1.0.0', description: 'Schedule C, SE tax, IRS brackets, state sales tax', author: 'A3P Team', category: 'jurisdiction', downloads: 0, rating: 5, installed: true },
  { id: 'jurisdiction-ca', name: 'Canada Tax Pack', version: '1.0.0', description: 'T2125, CPP/EI, GST/HST/PST, CRA brackets', author: 'A3P Team', category: 'jurisdiction', downloads: 0, rating: 5, installed: true },
  { id: 'jurisdiction-uk', name: 'UK Tax Pack', version: '1.0.0', description: 'Self Assessment, VAT, PAYE, Making Tax Digital', author: 'A3P Team', category: 'jurisdiction', downloads: 0, rating: 4, installed: false },
  { id: 'jurisdiction-eu', name: 'EU VAT Pack', version: '1.0.0', description: 'EU VAT, German/French income tax', author: 'A3P Team', category: 'jurisdiction', downloads: 0, rating: 4, installed: false },
  { id: 'jurisdiction-au', name: 'Australia Tax Pack', version: '1.0.0', description: 'BAS, GST, PAYG installments', author: 'A3P Team', category: 'jurisdiction', downloads: 0, rating: 4, installed: false },
];

export function listAvailableSkills(
  filter?: { category?: string; installed?: boolean },
): MarketplaceSkill[] {
  let skills = [...BUILT_IN_SKILLS];
  if (filter?.category) skills = skills.filter(s => s.category === filter.category);
  if (filter?.installed !== undefined) skills = skills.filter(s => s.installed === filter.installed);
  return skills;
}

export function installSkill(skillId: string): { success: boolean; message: string } {
  const skill = BUILT_IN_SKILLS.find(s => s.id === skillId);
  if (!skill) return { success: false, message: `Skill "${skillId}" not found` };
  if (skill.installed) return { success: false, message: `Skill "${skillId}" already installed` };
  skill.installed = true;
  skill.downloads++;
  return { success: true, message: `Skill "${skill.name}" installed successfully` };
}

export function publishSkill(manifest: { name: string; version: string; description: string; author: string; category: string }): PublishResult {
  // In production, this would validate, package, and upload to the marketplace
  const id = manifest.name.toLowerCase().replace(/\s+/g, '-');
  BUILT_IN_SKILLS.push({
    id,
    name: manifest.name,
    version: manifest.version,
    description: manifest.description,
    author: manifest.author,
    category: manifest.category as any,
    downloads: 0,
    rating: 0,
    installed: false,
  });
  return { success: true, skillId: id };
}
